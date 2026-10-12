import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { liquidDiagnosticWasmRoute } from "./liquid-diagnostic-wasm.mjs";
import { resolveProductionProbeWasm } from "./production-probe-wasm.mjs";
import { observeProbeWasmHttp } from "./fixtures/wasm-http-observation.mjs";
import {
	createHtmlProbeWasmPlugin,
	HTML_PRIVATE_WASM_ID,
} from "./html-probe-wasm-binding.mjs";
import {
	chromium,
	createServer,
	wasm,
	topLevelAwait,
} from "./browser-probe-toolchain.mjs";

const [executablePath, ffmpegDirectory, onlyBackend = "all"] =
	process.argv.slice(2);
assert(
	process.argv.length >= 4 &&
		process.argv.length <= 5 &&
		["all", "webgpu", "webgl"].includes(onlyBackend) &&
		[executablePath, ffmpegDirectory].every((p) => p && isAbsolute(p)),
	"Expected absolute private Chromium and FFmpeg-directory paths",
);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const assignedArtifactRoot = process.env.ROCUT_PROBE_ARTIFACT_ROOT;
const artifactRoot = assignedArtifactRoot
	? await realpath(assignedArtifactRoot)
	: join(root, ".artifacts");
// The host may opt into an existing task-owned C:\tmps directory. Resolve it
// before writes so a junction cannot redirect artifacts into a user profile.
assert(
	assignedArtifactRoot
		? isAbsolute(assignedArtifactRoot) &&
				/^c:[/\\]tmps[/\\]rocut-stylized-[a-z0-9_-]+$/i.test(artifactRoot)
		: /^e:/i.test(root),
	"Expected the default E: fixture or an explicit task-owned C:/tmps/rocut-stylized-* artifact root",
);
const readbackOverride = process.env.ROCUT_LIQUID_READBACK_PKG;
const wasmBinding = resolveProductionProbeWasm();
const defaultPkg = wasmBinding.directory;
assert(
	!/\bapplyEffectPassesReadback\b/.test(
		await readFile(join(defaultPkg, "opencut_wasm.js"), "utf8"),
	),
	"The production package must not contain feature-only readback exports",
);
const activePkg = readbackOverride
	? await realpath(readbackOverride)
	: defaultPkg;
if (readbackOverride) {
	const child = relative(artifactRoot, activePkg);
	assert(
		assignedArtifactRoot &&
			isAbsolute(readbackOverride) &&
			child &&
			!child.startsWith("..") &&
			!isAbsolute(child),
		"Diagnostic package must be an existing real directory within the assigned task artifact root",
	);
}
assert(
	/\bapplyEffectPassesReadback\b/.test(
		await readFile(join(activePkg, "opencut_wasm.js"), "utf8"),
	) === Boolean(readbackOverride),
	"Active WASM exports do not match the explicit production/diagnostic mode",
);
const parent = join(
	artifactRoot,
	readbackOverride ? "liquid-readback" : "liquid-effects",
);
await mkdir(parent, { recursive: true });
const artifacts = await mkdtemp(join(parent, "run-")),
	privateTemp = join(artifacts, "temp");
await mkdir(privateTemp);
Object.assign(process.env, {
	TEMP: privateTemp,
	TMP: privateTemp,
	TMPDIR: privateTemp,
});
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const manifestBytes = await readFile(join(root, "fixture-source.json")),
	manifest = JSON.parse(manifestBytes);
for (const file of manifest.files)
	assert.equal(
		digest(await readFile(join(root, file.path))),
		file.sha256,
		`Stale fixture manifest: ${file.path}`,
	);
await writeFile(join(artifacts, "source-manifest.json"), manifestBytes, {
	flag: "wx",
});
const evidence = {
	ok: false,
	mode: readbackOverride ? "browser-readback-tests" : "production-surface",
	artifactRoot,
	sourceCommit: manifest.sourceCommit,
	sourceWorktreeClean: false,
	sourceManifestSha256: digest(manifestBytes),
	defaultWasmSha256: digest(
		await readFile(join(defaultPkg, "opencut_wasm_bg.wasm")),
	),
	diagnosticWasmSha256: readbackOverride
		? digest(await readFile(join(activePkg, "opencut_wasm_bg.wasm")))
		: null,
	wasmSha256: digest(await readFile(join(activePkg, "opencut_wasm_bg.wasm"))),
	thresholds: {
		directRgb: 2,
		directAlpha: 1,
		identity: 0,
		compositeRgb: 3,
		inferredAlpha: 2 / 255,
		exportMeanRgba: 10,
		exportActiveRgb: 15,
		exportActivePixels: 2000,
	},
	attempts: [],
};
const server = await createServer({
	root,
	configFile: false,
	cacheDir: join(artifacts, "vite-cache"),
	logLevel: "error",
	plugins: [
		...(!readbackOverride ? [createHtmlProbeWasmPlugin(wasmBinding)] : []),
		wasm(),
		topLevelAwait(),
		...(readbackOverride ? [await liquidDiagnosticWasmRoute(activePkg)] : []),
	],
	optimizeDeps: { entries: ["script/fixtures/liquid-browser-probe.ts"] },
	resolve: {
		alias: {
			"opencut-wasm": readbackOverride
				? join(activePkg, "opencut_wasm.js")
				: HTML_PRIVATE_WASM_ID,
			mediabunny: join(root, "packages/editor-classic/node_modules/mediabunny"),
		},
	},
	server: {
		host: "127.0.0.1",
		port: 0,
		hmr: false,
		fs: { allow: [root, artifactRoot, wasmBinding.directory] },
	},
});

function decodeLiquid(directory, expected, baseline) {
	const movie = join(directory, "liquid.webm"),
		options = {
			windowsHide: true,
			timeout: 30000,
			maxBuffer: 16 * 1024 * 1024,
		};
	const metadata = JSON.parse(
		execFileSync(
			join(ffmpegDirectory, "ffprobe.exe"),
			[
				"-v",
				"error",
				"-count_frames",
				"-show_streams",
				"-show_frames",
				"-of",
				"json",
				movie,
			],
			{ ...options, encoding: "utf8" },
		),
	);
	const track = metadata.streams.find(
		(stream) => stream.codec_type === "video",
	);
	assert(
		track &&
			track.width === 640 &&
			track.height === 360 &&
			track.nb_read_frames === "6" &&
			track.codec_name === "vp9" &&
			track.r_frame_rate === "30/1",
		"Liquid export metadata mismatch",
	);
	const actual = execFileSync(
			join(ffmpegDirectory, "ffmpeg.exe"),
			[
				"-v",
				"error",
				"-i",
				movie,
				"-f",
				"rawvideo",
				"-pix_fmt",
				"rgba",
				"pipe:1",
			],
			options,
		),
		stride = 640 * 360 * 4;
	assert.equal(actual.length, stride * 6);
	assert.equal(expected.length, actual.length);
	assert.equal(baseline.length, stride);
	const metrics = [];
	for (let frame = 0; frame < 6; frame++) {
		let error = 0,
			activeError = 0,
			activePixels = 0;
		for (let i = 0; i < stride; i += 4) {
			const offset = frame * stride + i;
			for (let c = 0; c < 4; c++)
				error += Math.abs(actual[offset + c] - expected[offset + c]);
			if (
				[0, 1, 2].some(
					(c) => Math.abs(expected[offset + c] - baseline[i + c]) > 15,
				)
			) {
				activePixels++;
				for (let c = 0; c < 3; c++)
					activeError += Math.abs(actual[offset + c] - expected[offset + c]);
			}
		}
		const timestamp = Number(
			metadata.frames.filter((item) => item.media_type === "video")[frame]
				.best_effort_timestamp_time,
		);
		metrics.push({
			frame,
			meanRgbaError: error / stride,
			activeError: activeError / (activePixels * 3),
			activePixels,
			timestamp,
		});
	}
	return {
		ok: metrics.every(
			(m, i) =>
				m.meanRgbaError < 10 &&
				m.activeError < 15 &&
				m.activePixels > 2000 &&
				Math.abs(m.timestamp - i / 30) < 0.0011,
		),
		decoder: "independent FFmpeg/FFprobe",
		reference: "independent MAC + optical CPU oracle",
		metadata,
		metrics,
		expectedSha256: digest(expected),
	};
}
try {
	await server.listen();
	for (const backend of onlyBackend === "all"
		? ["webgpu", "webgl"]
		: [onlyBackend]) {
		const directory = join(artifacts, backend);
		await mkdir(directory);
		const attempt = {
			requestedBackend: backend,
			ok: false,
			errors: [],
			externalRequests: [],
		};
		evidence.attempts.push(attempt);
		let context, wasmHttp;
		try {
			// Chromium's WebGPU selector is independent of ANGLE's WebGL selector.
			// Without this flag Windows defaults to D3D12, unavailable on this host.
			attempt.browserArgs = [
				"--no-proxy-server",
				"--enable-unsafe-swiftshader",
				"--use-angle=swiftshader",
				"--use-gl=angle",
				...(backend === "webgpu"
					? ["--enable-unsafe-webgpu", "--use-webgpu-adapter=swiftshader"]
					: ["--disable-webgpu"]),
			];
			context = await chromium.launchPersistentContext(
				join(directory, "browser-profile"),
				{
					headless: true,
					executablePath,
					env: { ...process.env },
					args: attempt.browserArgs,
				},
			);
			attempt.browser = context.browser()?.version();
			if (backend === "webgl")
				await context.addInitScript(() =>
					Object.defineProperty(Navigator.prototype, "gpu", {
						get: () => undefined,
						configurable: true,
					}),
				);
			const page = await context.newPage();
			attempt.console = [];
			page.on("console", (message) => {
				if (
					["warning", "error"].includes(message.type()) &&
					attempt.console.length < 50
				)
					attempt.console.push({ type: message.type(), text: message.text() });
			});
			page.on("pageerror", (error) => attempt.errors.push(error.message));
			await page.route("**/*", async (route) => {
				const url = new URL(route.request().url());
				if (/^https?:$/.test(url.protocol) && url.hostname !== "127.0.0.1") {
					attempt.externalRequests.push(url.origin);
					await route.abort();
				} else await route.continue();
			});
			console.log(JSON.stringify({ phase: backend, artifacts }));
			const address = server.httpServer.address();
			const activeWasmBytes = await readFile(
				join(activePkg, "opencut_wasm_bg.wasm"),
			);
			const wasmCdp = await page.context().newCDPSession(page);
			wasmHttp = await observeProbeWasmHttp(wasmCdp, {
				url: `http://127.0.0.1:${address.port}/@fs/${join(activePkg, "opencut_wasm_bg.wasm").replaceAll("\\", "/")}`,
				sha256: evidence.wasmSha256,
				byteLength: activeWasmBytes.length,
			});
			await page.goto(
				`http://127.0.0.1:${address.port}/script/fixtures/liquid-browser-probe.html?backend=${backend}${readbackOverride ? "&readback=1" : ""}`,
				{ waitUntil: "commit" },
			);
			await page.waitForFunction(() => globalThis.__liquidResult, undefined, {
				timeout: 180000,
			});
			Object.assign(
				attempt,
				await page.evaluate(() => ({
					...globalThis.__liquidResult,
					wasmInitializationStamp: globalThis.__htmlProbeWasmIdentity ?? null,
				})),
			);
			const media = await page.evaluate(() => globalThis.__liquidMedia),
				sheet = await page.evaluate(() => globalThis.__liquidSheet);
			if (sheet)
				await writeFile(
					join(directory, "contact-sheet.png"),
					Buffer.from(sheet.split(",")[1], "base64"),
					{ flag: "wx" },
				);
			if (media) {
				const expected = Buffer.from(media.expected, "base64"),
					baseline = Buffer.from(media.baseline, "base64");
				for (const [name, bytes] of [
					["liquid.webm", Buffer.from(media.video, "base64")],
					["expected.rgba", expected],
					["baseline.rgba", baseline],
				])
					await writeFile(join(directory, name), bytes, { flag: "wx" });
				attempt.decoded = decodeLiquid(directory, expected, baseline);
			}
			attempt.ok = Boolean(
				attempt.ok &&
				attempt.decoded?.ok &&
				attempt.errors.length === 0 &&
				attempt.externalRequests.length === 0,
			);
		} catch (error) {
			attempt.ok = false;
			attempt.failure = String(error.stack ?? error);
		} finally {
			try {
				if (wasmHttp) {
					attempt.wasmHttp = await wasmHttp.drain();
					attempt.ok = attempt.ok && attempt.wasmHttp.ok;
				}
			} catch (error) {
				attempt.ok = false;
				attempt.failure ??= String(error.stack ?? error);
			} finally {
				await context?.close();
			}
		}
		await writeFile(
			join(directory, "evidence.json"),
			JSON.stringify(attempt, null, 2) + "\n",
			{ flag: "wx" },
		);
		console.log(
			JSON.stringify({
				backend,
				ok: attempt.ok,
				failure: attempt.failure,
				failures: attempt.failures,
			}),
		);
	}
	evidence.ok = evidence.attempts.every((attempt) => attempt.ok);
} catch (error) {
	evidence.failure = String(error.stack ?? error);
} finally {
	await server.close();
	await writeFile(
		join(artifacts, "evidence.json"),
		JSON.stringify(evidence, null, 2) + "\n",
		{ flag: "wx" },
	);
	console.log(JSON.stringify({ ok: evidence.ok, artifacts }));
	if (!evidence.ok) process.exitCode = 1;
}

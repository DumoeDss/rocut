import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	chromium,
	createServer,
	wasm,
	topLevelAwait,
} from "./browser-probe-toolchain.mjs";

const [executablePath, ffmpegDirectory, mode] = process.argv.slice(2);
const refractionOnly = mode === "--refraction-only";
const clothOnly = mode === "--cloth";
assert(
	(process.argv.length === 4 ||
		(process.argv.length === 5 && (refractionOnly || clothOnly))) &&
		[executablePath, ffmpegDirectory].every((p) => p && isAbsolute(p)),
	"Expected absolute private Chromium and FFmpeg-directory paths",
);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
assert(
	/^e:[\\/]/i.test(root),
	"Mesh probe artifacts must remain on the authorized E: workspace",
);
const parent = join(root, ".artifacts/mesh-scenes");
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
		`Stale fixture: ${file.path}`,
	);
await writeFile(join(artifacts, "source-manifest.json"), manifestBytes, {
	flag: "wx",
});
const evidence = {
	ok: false,
	errors: [],
	externalRequests: [],
	backend: refractionOnly
		? "private Chromium direct production WebGL2 mesh raster; no WASM scene/export/Host/Electron"
		: "private Chromium canvas-worker WebGL2 mesh; native Rocut export; no Host/Electron",
	mode: refractionOnly
		? "raster-refraction-only-no-export"
		: clothOnly
			? "cloth-scenes"
			: "full-mesh-scenes",
	sourceCommit: manifest.sourceCommit,
	sourceWorktreeClean: false,
	sourceManifestSha256: digest(manifestBytes),
	wasmSha256: digest(
		await readFile(join(root, "rust/wasm/pkg/opencut_wasm_bg.wasm")),
	),
};
const entry = "/script/fixtures/mesh-scenes-browser.ts";
const entryFunction = refractionOnly
	? "runMeshRefractionProbe"
	: clothOnly
		? "runClothScenesProbe"
		: "runMeshScenesProbe";
const server = await createServer({
	root,
	configFile: false,
	cacheDir: join(artifacts, "vite-cache"),
	logLevel: "error",
	plugins: [
		wasm(),
		topLevelAwait(),
		{
			name: "private-mesh-scenes-entry",
			configureServer(server) {
				server.middlewares.use((request, response, next) => {
					if (request.url !== "/mesh-scenes") return next();
					response.setHeader("content-type", "text/html; charset=utf-8");
					response.end(
						`<!doctype html><meta charset="utf-8"><title>Rocut mesh scenes</title><script type="module">import {${entryFunction}} from '${entry}';${entryFunction}().then(r=>globalThis.__meshScenesResult=r).catch(e=>globalThis.__meshScenesResult={ok:false,error:String(e),stack:e.stack});</script>`,
					);
				});
			},
		},
	],
	optimizeDeps: { entries: [entry.slice(1)] },
	resolve: {
		alias: {
			"opencut-wasm": join(root, "rust/wasm/pkg/opencut_wasm.js"),
			mediabunny: join(root, "packages/editor-classic/node_modules/mediabunny"),
		},
	},
	server: { host: "127.0.0.1", port: 0, hmr: false },
});

async function decodeVariant(name) {
	const directory = join(artifacts, name),
		movie = join(directory, "mesh.webm");
	const options = {
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
				"-show_format",
				"-of",
				"json",
				movie,
			],
			{ ...options, encoding: "utf8" },
		),
	);
	const track = metadata.streams.find((s) => s.codec_type === "video");
	assert(
		track &&
			track.width === 384 &&
			track.height === 216 &&
			track.nb_read_frames === "6",
	);
	assert.equal(track.codec_name, "vp9");
	assert.equal(track.r_frame_rate, "30/1");
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
	);
	const preview = await readFile(join(directory, "preview.rgba")),
		oracle = await readFile(join(directory, "oracle.rgba")),
		mask = await readFile(join(directory, "oracle-mask.bin")),
		stride = 384 * 216 * 4;
	assert.equal(actual.length, stride * 6);
	assert.equal(preview.length, actual.length);
	assert.equal(oracle.length, actual.length);
	assert.equal(mask.length, actual.length / 4);
	const metrics = [];
	for (let frame = 0; frame < 6; frame++) {
		let previewError = 0,
			oracleError = 0,
			checked = 0,
			detail = 0,
			detailError = 0,
			contrast = 0,
			actualContrast = 0,
			motion = 0;
		for (let p = 0; p < stride; p += 4) {
			const i = frame * stride + p;
			for (let c = 0; c < 4; c++) {
				previewError += Math.abs(actual[i + c] - preview[i + c]);
				motion += Math.abs(actual[i + c] - actual[p + c]);
			}
			if (!mask[i / 4]) continue;
			checked++;
			for (let c = 0; c < 4; c++)
				oracleError += Math.abs(actual[i + c] - oracle[i + c]);
			const expectedContrast = [16, 32, 48].reduce(
				(sum, bg, c) => sum + Math.abs(oracle[i + c] - bg),
				0,
			);
			if (expectedContrast <= 45) continue;
			detail++;
			contrast += expectedContrast;
			for (let c = 0; c < 3; c++) {
				detailError += Math.abs(actual[i + c] - oracle[i + c]);
				actualContrast += Math.abs(actual[i + c] - [16, 32, 48][c]);
			}
		}
		metrics.push({
			frame,
			sourceFrame: frame + 6,
			previewError: previewError / stride,
			oracleError: oracleError / (checked * 4),
			checked,
			coverage: checked / (stride / 4),
			detail,
			detailError: detailError / (detail * 3),
			contrastRatio: actualContrast / contrast,
			motion: motion / stride,
		});
	}
	const ok =
		metrics.every(
			(m) =>
				m.previewError < 10 &&
				m.oracleError < 10 &&
				m.coverage > 0.2 &&
				m.detail > 500 &&
				m.detailError < 25 &&
				m.contrastRatio > 0.7 &&
				m.contrastRatio < 1.3,
		) && metrics.at(-1).motion > 0.1;
	const result = {
		name,
		ok,
		decoder: "independent FFmpeg/FFprobe",
		metadata,
		metrics,
		references:
			"production preview parity plus independently derived geometry/UV/alpha oracle",
		videoSha256: digest(await readFile(movie)),
		oracleSha256: digest(oracle),
		maskSha256: digest(mask),
	};
	await writeFile(
		join(directory, "independent-mesh-decode.json"),
		JSON.stringify(result, null, 2) + "\n",
		{ flag: "wx" },
	);
	assert(
		ok,
		`${name}: independent decode quality gate failed; artifacts retained`,
	);
	return result;
}

let context;
try {
	await server.listen();
	context = await chromium.launchPersistentContext(
		join(artifacts, "browser-profile"),
		{
			headless: true,
			executablePath,
			env: {
				...process.env,
				TEMP: privateTemp,
				TMP: privateTemp,
				TMPDIR: privateTemp,
			},
			args: [
				"--no-proxy-server",
				"--enable-unsafe-webgpu",
				"--enable-unsafe-swiftshader",
				"--use-angle=swiftshader",
				"--use-gl=angle",
			],
		},
	);
	evidence.browser = context.browser()?.version();
	const page = await context.newPage();
	page.on("pageerror", (error) => evidence.errors.push(error.message));
	await page.route("**/*", async (route) => {
		const url = new URL(route.request().url());
		if (/^https?:$/.test(url.protocol) && url.hostname !== "127.0.0.1") {
			evidence.externalRequests.push(url.origin);
			await route.abort();
		} else await route.continue();
	});
	console.log(JSON.stringify({ phase: "mesh-scenes-browser", artifacts }));
	const address = server.httpServer.address();
	await page.goto(`http://127.0.0.1:${address.port}/mesh-scenes`, {
		waitUntil: "commit",
	});
	await page.waitForFunction(() => globalThis.__meshScenesResult, undefined, {
		timeout: 300000,
	});
	const result = await page.evaluate(() => globalThis.__meshScenesResult);
	Object.assign(evidence, result);
	const diagnostic = await page.evaluate(() => globalThis.__meshScenesFailure);
	if (diagnostic) {
		const { actual, expected, mask, ...summary } = diagnostic;
		evidence.pixelFailure = summary;
		for (const [name, bytes] of [
			["failed-actual.rgba", actual],
			["failed-expected.rgba", expected],
			["failed-mask.bin", mask],
		])
			if (bytes)
				await writeFile(join(artifacts, name), Buffer.from(bytes, "base64"), {
					flag: "wx",
				});
	}
	const variants = await page.evaluate(
		() => globalThis.__meshScenesMedia ?? [],
	);
	for (const variant of variants) {
		assert(/^(bend|grid|hex|shatter|cloth)(-[a-z0-9]+)*$/.test(variant.name));
		const directory = join(artifacts, variant.name);
		await mkdir(directory);
		for (const [file, bytes] of [
			["mesh.webm", Buffer.from(variant.video, "base64")],
			["preview.rgba", Buffer.from(variant.preview, "base64")],
			["oracle.rgba", Buffer.from(variant.oracle, "base64")],
			["oracle-mask.bin", Buffer.from(variant.mask, "base64")],
			["contact-sheet.png", Buffer.from(variant.sheet.split(",")[1], "base64")],
		])
			await writeFile(join(directory, file), bytes, { flag: "wx" });
	}
	assert(
		result.ok &&
			evidence.errors.length === 0 &&
			evidence.externalRequests.length === 0,
		"Mesh scenes browser assertions failed; artifacts retained",
	);
	if (clothOnly)
		assert(
			variants.some((v) => v.name === "cloth-events") &&
				variants.some((v) => v.name === "cloth-wind"),
			"Missing Cloth events/wind export group",
		);
	else if (!refractionOnly)
		assert(
			variants.some((v) => v.name === "cloth-events") &&
				variants.some((v) => v.name === "cloth-wind") &&
				variants.some((v) => v.name === "bend") &&
				variants.some((v) => v.name === "shatter") &&
				variants.some((v) => v.name === "bend-back") &&
				variants.some((v) => v.name.startsWith("grid")) &&
				variants.some((v) => v.name.startsWith("hex")),
			"Missing Cloth/Bend/Grid/Hex/Shatter export group",
		);
	evidence.decoded = [];
	for (const variant of variants)
		evidence.decoded.push(await decodeVariant(variant.name));
	evidence.ok = true;
} catch (error) {
	evidence.ok = false;
	evidence.failure = String(error.stack ?? error);
	process.exitCode = 1;
} finally {
	await context?.close();
	await server.close();
	await writeFile(
		join(artifacts, "evidence.json"),
		JSON.stringify(evidence, null, 2) + "\n",
		{ flag: "wx" },
	);
	console.log(
		JSON.stringify({ ok: evidence.ok, failure: evidence.failure, artifacts }),
	);
}

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, chromium } from "./browser-probe-toolchain.mjs";
import { capture, poll, seek } from "./fixtures/stylized-fusion-checks.mjs";
import { normalizeLiquidPreview } from "./fixtures/liquid-editor-export-decode.mjs";
import {
	prepareLiquidExportBaseline,
	verifyLiquidExportBytes,
} from "./fixtures/liquid-editor-export-persistence.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [artifactRoot, executablePath, bun, sourceRun, ffmpegDirectory] =
	process.argv.slice(2);
assert.equal(process.argv.length, 7);
assert(
	[artifactRoot, executablePath, bun, sourceRun, ffmpegDirectory].every(
		(value) => value && isAbsolute(value),
	),
);
const accepted = JSON.parse(
	await readFile(join(sourceRun, "evidence.json"), "utf8"),
);
assert(accepted.ok && accepted.hostRestart.hostReopenedAfterEdits);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const manifestBytes = await readFile(join(root, "fixture-source.json"));
const manifest = JSON.parse(manifestBytes);
for (const file of manifest.files)
	assert.equal(
		digest(await readFile(join(root, file.path))),
		file.sha256,
		`Unsynchronized source: ${file.path}`,
	);
const parent = join(artifactRoot, "liquid-editor-full");
await mkdir(parent, { recursive: true });
const artifacts = await mkdtemp(join(parent, "run-"));
const temp = join(artifacts, "temp");
await mkdir(temp);
const editorDist =
	process.env.ROCUT_LIQUID_EDITOR_DIST || join(temp, "editor-dist");
assert(isAbsolute(editorDist));
const wasmSha256 = digest(
	await readFile(join(root, "rust/wasm/pkg/opencut_wasm_bg.wasm")),
);
await writeFile(join(artifacts, "source-manifest.json"), manifestBytes, {
	flag: "wx",
});
const TIMELINE_TICKS = 600000;
const FPS = 30;
const TICKS_PER_FRAME = 4000;
const expectedFrames = Math.round(TIMELINE_TICKS / TICKS_PER_FRAME);
const timelineSeconds = TIMELINE_TICKS / (TICKS_PER_FRAME * FPS);
const evidence = {
	ok: false,
	mode: "existing-ui-project-full-duration-export",
	sourceManifestSha256: digest(manifestBytes),
	wasmSha256,
	backend: "private Chromium SwiftShader",
	installedPluginTested: false,
	electronTested: false,
	expectedFrames,
	timelineTicks: TIMELINE_TICKS,
	checks: [],
	errors: [],
	consoleErrors: [],
	warnings: [],
	buildWarnings: [],
	externalRequests: [],
	httpFailures: [],
};
const env = {
	...process.env,
	TEMP: temp,
	TMP: temp,
	TMPDIR: temp,
	ELFTIA_HTML_FRAME_CONNECTION_FILE: "",
};
const redact = (value) =>
	String(value).replace(/https?:\/\/[^\s"'<>]+/g, "[URL redacted]");
console.log(JSON.stringify({ phase: "preparing-liquid-full-export", artifacts }));
let browser,
	page,
	host,
	exited,
	hostError = "";
try {
	if (process.env.ROCUT_LIQUID_EDITOR_DIST) {
		const old = JSON.parse(
			await readFile(join(editorDist, "../../source-manifest.json"), "utf8"),
		);
		const rendererFiles = (entry) =>
			entry.files.filter(
				(file) =>
					!file.path.startsWith("script/") &&
					!file.path.startsWith("apps/cli/"),
			);
		assert.deepEqual(
			rendererFiles(old),
			rendererFiles(manifest),
			"Cached editor source differs",
		);
		evidence.reusedEditorDist = editorDist;
	} else {
		console.log(JSON.stringify({ phase: "building-private-editor" }));
		await build({
			root: join(root, "apps/vite-example"),
			configFile: join(root, "apps/vite-example/vite.config.ts"),
			cacheDir: join(temp, "vite-cache"),
			logLevel: "warn",
			resolve: {
				alias: { "opencut-wasm": join(root, "rust/wasm/pkg/opencut_wasm.js") },
			},
			build: {
				outDir: editorDist,
				emptyOutDir: false,
				rollupOptions: {
					onwarn(warning, defaultHandler) {
						evidence.buildWarnings.push({
							code: warning.code,
							message: warning.message,
						});
						defaultHandler(warning);
					},
				},
			},
		});
	}
	const wasmFiles = (await readdir(join(editorDist, "assets"))).filter(
		(file) => file.startsWith("opencut_wasm_bg-") && file.endsWith(".wasm"),
	);
	assert.equal(wasmFiles.length, 1);
	assert.equal(
		digest(await readFile(join(editorDist, "assets", wasmFiles[0]))),
		wasmSha256,
	);
	evidence.editorDist = editorDist;
	host = spawn(
		bun,
		[
			"--preload",
			"./script/fixtures/local-wasm-preload.mjs",
			"script/fixtures/liquid-editor-export-host.ts",
			artifacts,
			editorDist,
			sourceRun,
		],
		{
			cwd: root,
			windowsHide: true,
			stdio: ["pipe", "pipe", "pipe"],
			env,
		},
	);
	exited = new Promise((resolve) => host.once("exit", resolve));
	host.stderr.on("data", (chunk) => {
		hostError = (hostError + redact(chunk)).slice(-12000);
	});
	const editorUrl = await new Promise((resolve, reject) => {
		let buffered = "";
		const timer = setTimeout(
			() => reject(Error("Liquid export Host startup deadline exceeded")),
			120000,
		);
		host.once("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		host.once("exit", (code) => {
			clearTimeout(timer);
			reject(Error(`Liquid export Host exited ${code}: ${hostError}`));
		});
		host.stdout.on("data", (chunk) => {
			buffered += chunk.toString();
			let boundary;
			while ((boundary = buffered.indexOf("\n")) >= 0) {
				const line = buffered.slice(0, boundary);
				buffered = buffered.slice(boundary + 1);
				try {
					const message = JSON.parse(line);
					if (message.editorUrl) {
						clearTimeout(timer);
						resolve(message.editorUrl);
					}
				} catch {
					/* Only the private readiness envelope is consumed. */
				}
			}
		});
	});
	browser = await chromium.launch({
		headless: true,
		executablePath,
		env,
		args: [
			"--no-proxy-server",
			"--enable-unsafe-webgpu",
			"--enable-unsafe-swiftshader",
			"--use-angle=swiftshader",
			"--use-gl=angle",
		],
	});
	evidence.browser = browser.version();
	page = await browser.newPage({
		viewport: { width: 1440, height: 1000 },
		deviceScaleFactor: 1,
	});
	await page.route(
		(url) => /^https?:$/.test(url.protocol) && url.hostname !== "127.0.0.1",
		async (route) => {
			evidence.externalRequests.push(new URL(route.request().url()).origin);
			await route.abort();
		},
	);
	page.on("pageerror", (error) => evidence.errors.push(redact(error.message)));
	page.on("console", (message) => {
		if (message.type() === "warning")
			evidence.warnings.push(redact(message.text()));
		if (message.type() === "error")
			evidence.consoleErrors.push(redact(message.text()));
	});
	page.on("response", (response) => {
		if (response.status() < 400) return;
		const pathname = new URL(response.url()).pathname;
		const path = "/" + pathname.slice(new URL(editorUrl).pathname.length);
		evidence.httpFailures.push({ path, status: response.status() });
	});
	const request = async (route, body) => {
		const response = await fetch(new URL(`api/${route}`, editorUrl), {
			signal: AbortSignal.timeout(15000),
			...(body === undefined
				? {}
				: {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(body),
					}),
		});
		const value = await response.json();
		assert(
			response.ok,
			`${route}: ${response.status} ${JSON.stringify(value)}`,
		);
		return value;
	};
	await page.goto(editorUrl, { waitUntil: "commit", timeout: 90000 });
	await page
		.locator('[data-testid="timeline-clip"][data-element-id="liquid-0"]')
		.waitFor({ timeout: 120000 });
	await page.waitForFunction(
		async () => (await (await fetch("api/export")).json()).surfaces === 1,
		undefined,
		{ timeout: 30000 },
	);
	console.log(JSON.stringify({ phase: "liquid-full-editor-attached" }));
	const before = JSON.parse(
		await readFile(join(artifacts, "reopened-for-export.json"), "utf8"),
	);
	assert(before.ok);
	const byId = (items) => [...items].sort((a, b) => a.id.localeCompare(b.id));
	assert.deepEqual(byId(await request("clips")), before.clips);
	const overlay = page
		.getByRole("application", { name: "Preview canvas", exact: true })
		.locator("..");
	const main = before.tracks.find((track) => track.kind === "video");
	const emptyTrack = await page
		.getByRole("button", { name: `Select ${main.name} track`, exact: true })
		.boundingBox();
	assert(emptyTrack);
	await page.mouse.click(
		emptyTrack.x + emptyTrack.width / 2,
		emptyTrack.y + emptyTrack.height / 2,
	);
	await page.getByText("It's empty here", { exact: true }).waitFor();
	const canvas = page
		.locator('canvas[width="640"][height="360"]')
		.filter({ visible: true });
	await page.getByLabel("Preview zoom", { exact: true }).click();
	await page.getByRole("option", { name: "100%", exact: true }).click();
	await page.keyboard.press("Escape");
	// Sample three timeline positions for the independent decode comparison.
	const samples = [1, Math.round(expectedFrames / 2), expectedFrames - 2].map(
		(frame) => ({ frame, ticks: frame * TICKS_PER_FRAME }),
	);
	evidence.previewFrames = [];
	for (const sample of samples) {
		await seek(page, Math.floor(sample.frame / FPS), sample.frame % FPS);
		await page
			.getByRole("button", { name: "Edit playhead time", exact: true })
			.waitFor({ state: "visible" });
		assert.equal(await overlay.locator("button").count(), 0);
		const visible = await capture(
			page,
			artifacts,
			`liquid-full-preview-${sample.frame}`,
		);
		const name = `liquid-full-normalized-${sample.frame}.png`;
		const bounds = visible.bounds;
		const { rgba, filter } = await normalizeLiquidPreview(
			join(artifacts, `${visible.name}.png`),
			bounds,
			ffmpegDirectory,
			join(artifacts, name),
		);
		assert.equal(rgba.length, 640 * 360 * 4);
		let activePixels = 0;
		for (let index = 0; index < rgba.length; index += 4) {
			assert.equal(rgba[index + 3], 255);
			if (
				[32, 48, 64].some(
					(background, channel) =>
						Math.abs(rgba[index + channel] - background) > 15,
				)
			)
				activePixels++;
		}
		assert(activePixels > 2000, "Sampled preview frame lacks active detail");
		evidence.previewFrames.push({
			frame: sample.frame,
			ticks: sample.ticks,
			name,
			sha256: digest(await readFile(join(artifacts, name))),
			activePixels,
			width: 640,
			height: 360,
			normalizationFilter: filter,
		});
	}
	const exportBaseline = await prepareLiquidExportBaseline(
		artifacts,
		sourceRun,
		request,
		evidence,
	);
	console.log(
		JSON.stringify({ phase: "full-duration-export-started", expectedFrames }),
	);
	const started = await request("export", {
		format: "webm",
		quality: "very_high",
		includeAudio: false,
		range: { startTime: 0, endTime: TIMELINE_TICKS },
	});
	const finished = await poll(async () => {
		const job = await request(`export/${started.id}`);
		return ["completed", "failed", "cancelled"].includes(job.status)
			? job
			: null;
	}, 1800000);
	assert.equal(finished.status, "completed", finished.error);
	evidence.export = finished;
	await verifyLiquidExportBytes(artifacts, sourceRun, exportBaseline, evidence);
	// Independent FFprobe/FFmpeg verification of the complete timeline.
	const { execFileSync } = await import("node:child_process");
	const runFf = (name, args) =>
		execFileSync(join(ffmpegDirectory, name), args, {
			windowsHide: true,
			timeout: 120000,
			maxBuffer: 64 * 1024 * 1024,
			encoding: "utf8",
		});
	const metadata = JSON.parse(
		runFf("ffprobe.exe", [
			"-v",
			"error",
			"-count_frames",
			"-show_streams",
			"-show_format",
			"-show_frames",
			"-of",
			"json",
			finished.outputPath,
		]),
	);
	const track = metadata.streams[0];
	assert.equal(track.width, 640);
	assert.equal(track.height, 360);
	assert.equal(track.nb_read_frames, String(expectedFrames));
	assert.equal(track.r_frame_rate, "30/1");
	assert(Math.abs(Number(metadata.format.duration) - timelineSeconds) < 0.01);
	assert.equal(metadata.frames.length, expectedFrames);
	metadata.frames.forEach((frame, index) =>
		assert(
			Math.abs(Number(frame.best_effort_timestamp_time) - index / FPS) < 0.0011,
			`Frame ${index} PTS mismatch`,
		),
	);
	evidence.probe = {
		width: 640,
		height: 360,
		frameRate: "30/1",
		frameCount: expectedFrames,
		durationSeconds: Number(metadata.format.duration),
		ptsFirst: metadata.frames[0].best_effort_timestamp_time,
		ptsLast: metadata.frames[expectedFrames - 1].best_effort_timestamp_time,
	};
	// Compare the three sampled UI previews against matching export frames.
	const pixels = (file, frame) =>
		execFileSync(
			join(ffmpegDirectory, "ffmpeg.exe"),
			[
				"-v",
				"error",
				"-i",
				file,
				"-vf",
				`select=eq(n\\,${frame})`,
				"-frames:v",
				"1",
				"-pix_fmt",
				"rgb24",
				"-f",
				"rawvideo",
				"pipe:1",
			],
			{ windowsHide: true, timeout: 60000, maxBuffer: 16 * 1024 * 1024 },
		);
	evidence.decodedComparisons = [];
	const thresholds = { meanRgb: 10, activeRgb: 15, activePixels: 2000 };
	for (const sample of evidence.previewFrames) {
		const expected = pixels(join(artifacts, sample.name), 0);
		const actual = pixels(finished.outputPath, sample.frame);
		assert.equal(expected.length, 640 * 360 * 3);
		assert.equal(actual.length, expected.length);
		let absolute = 0,
			activeAbsolute = 0,
			activeCount = 0;
		for (let index = 0; index < expected.length; index += 3) {
			const active = [0, 1, 2].some(
				(channel) =>
					Math.abs(expected[index + channel] - [32, 48, 64][channel]) > 15,
			);
			for (let channel = 0; channel < 3; channel++) {
				const delta = Math.abs(
					expected[index + channel] - actual[index + channel],
				);
				absolute += delta;
				if (active) {
					activeAbsolute += delta;
					activeCount++;
				}
			}
		}
		const comparison = {
			frame: sample.frame,
			meanRgb: absolute / expected.length,
			activeRgb: activeAbsolute / Math.max(activeCount, 1),
		};
		evidence.decodedComparisons.push(comparison);
		assert(
			comparison.meanRgb <= thresholds.meanRgb,
			`Frame ${sample.frame} meanRgb ${comparison.meanRgb} exceeds ${thresholds.meanRgb}`,
		);
		assert(
			comparison.activeRgb <= thresholds.activeRgb,
			`Frame ${sample.frame} activeRgb ${comparison.activeRgb} exceeds ${thresholds.activeRgb}`,
		);
	}
	evidence.thresholds = thresholds;
	assert.deepEqual(byId(await request("clips")), before.clips);
	assert.deepEqual(byId(await request("tracks")), before.tracks);
	assert.equal((await request("context")).revision, before.revision);
	evidence.checks.push({
		name: `same real UI-edited persisted project, complete ${timelineSeconds} s timeline export (${expectedFrames} frames), independent FFmpeg decode against three normalized UI preview frames`,
		pass: true,
	});
	assert.deepEqual(evidence.errors, []);
	assert.deepEqual(evidence.externalRequests, []);
	assert.deepEqual(
		evidence.httpFailures.filter(
			(failure) =>
				!(
					failure.status === 404 &&
					failure.path === "/api/library/graph-editor-presets/user-presets"
				),
		),
		[],
	);
	assert(
		evidence.consoleErrors.every(
			(message) =>
				message ===
					"Failed to load resource: the server responded with a status of 404 (Not Found)" ||
				message.startsWith(
					"Failed to render preview frame: AbortError: signal is aborted without reason",
				),
		),
	);
	evidence.expectedConsoleErrors = evidence.consoleErrors;
	evidence.ok = true;
} catch (error) {
	evidence.failure = redact(error.stack ?? error);
	if (page) {
		await page
			.screenshot({ path: join(artifacts, "failure.png") })
			.catch(() => {});
		await writeFile(
			join(artifacts, "failure-ui.txt"),
			await page
				.locator("body")
				.innerText()
				.catch(() => ""),
			{ flag: "wx" },
		);
	}
	process.exitCode = 1;
} finally {
	await browser?.close();
	if (host && host.exitCode === null && host.signalCode === null)
		host.stdin.end("stop\n");
	if (exited) await exited;
	if (evidence.ok) {
		try {
			assert.equal(host.exitCode, 0, "Host restart verification failed");
			evidence.hostRestart = JSON.parse(
				await readFile(join(artifacts, "reopened-after-edit.json"), "utf8"),
			);
			assert.equal(evidence.hostRestart.ok, true);
		} catch (error) {
			evidence.ok = false;
			evidence.failure = redact(error.stack ?? error);
			process.exitCode = 1;
		}
	}
	if (hostError) evidence.hostDiagnostics = hostError;
	await writeFile(
		join(artifacts, "evidence.json"),
		JSON.stringify(evidence, null, 2),
		{ flag: "wx" },
	);
	console.log(
		JSON.stringify({ ok: evidence.ok, failure: evidence.failure, artifacts }),
	);
}
process.exit(process.exitCode ?? 0);

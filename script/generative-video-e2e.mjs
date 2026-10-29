import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { exportAndDecode } from "./generative-video-e2e-media.mjs";
import { chromium } from "./browser-probe-toolchain.mjs";

const repo = fileURLToPath(new URL("..", import.meta.url));
const buildRoot = join(repo, ".tmp/generative-video-e2e-20261029");
const root = resolve(process.argv[2] ?? join(buildRoot, `run-${Date.now()}`));
const delivery = resolve(process.argv[3] ?? join(buildRoot, "runtime"));
assert(
	root.startsWith(resolve(repo, ".tmp") + "\\") ||
		root.startsWith(resolve(repo, ".tmp") + "/"),
);
assert(
	!existsSync(join(root, "project")),
	"Use a fresh isolated run directory",
);
const ffmpeg =
	process.env.ROCUT_NATIVE_FFMPEG_PATH ??
	"E:/Software/ffmpeg-6.0-full_build/bin/ffmpeg.exe";
const ffprobe =
	process.env.ROCUT_NATIVE_FFPROBE_PATH ??
	"E:/Software/ffmpeg-6.0-full_build/bin/ffprobe.exe";
const run = promisify(execFile);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const report = {
	startedAt: new Date().toISOString(),
	checks: [],
	errors: [],
	scope:
		"Private Native project and real Chromium renderer export; synthetic licensed-by-construction media; no generation calls",
};
const evidence = join(root, "evidence");
const fixtures = join(root, "fixtures");
let host, browser, page, target, editorUrl;
const entry = join(delivery, "rocut.mjs");
const targets = join(root, "targets");
async function mark(name, value) {
	report.checks.push({ name, value });
	await writeFile(
		join(evidence, "report.json"),
		JSON.stringify(report, null, 2),
	);
	console.log(name);
}
async function cli(...args) {
	const result = await run(
		process.execPath,
		[entry, ...args, "--target", target, "--targets-root", targets],
		{ windowsHide: true, timeout: 180000, maxBuffer: 8e6 },
	);
	return JSON.parse(result.stdout);
}
let serial = 0;
async function spec(name, body) {
	const file = join(evidence, `${++serial}-${name}.json`);
	await writeFile(file, JSON.stringify(body, null, 2));
	return file;
}
async function apply(name, operations) {
	const before = await cli("read");
	return cli(
		"apply",
		await spec(name, {
			expectedRevision: before.revision,
			idempotencyKey: name,
			operations,
		}),
	);
}
async function startHost() {
	host = spawn(
		process.execPath,
		[
			entry,
			"host",
			"start",
			join(root, "project"),
			"--static",
			join(delivery, "surface"),
			"--targets-root",
			targets,
			"--port",
			"0",
		],
		{
			windowsHide: true,
			stdio: ["ignore", "pipe", "pipe"],
			env: {
				...process.env,
				ROCUT_NATIVE_FFMPEG_PATH: ffmpeg,
				ROCUT_NATIVE_FFPROBE_PATH: ffprobe,
			},
		},
	);
	let output = "",
		errors = "";
	host.stdout.on("data", (chunk) => {
		output += chunk;
	});
	host.stderr.on("data", (chunk) => {
		errors += chunk;
	});
	for (let n = 0; n < 120 && !output.includes("editorUrl "); n++) {
		if (host.exitCode !== null) throw Error(errors);
		await new Promise((done) => setTimeout(done, 250));
	}
	target = output.match(/target (\S+)/)?.[1];
	editorUrl = output.match(/editorUrl (\S+)/)?.[1];
	assert(target && editorUrl, "Host did not expose an authenticated surface");
}
async function stopHost() {
	if (host?.exitCode === null) {
		const stopped = new Promise((done) => host.once("exit", done));
		host.kill();
		await stopped;
	}
}
async function openSurface() {
	await page.goto(editorUrl, { waitUntil: "domcontentloaded" });
	await page
		.locator('[data-editor-surface][role="region"]')
		.waitFor({ timeout: 120000 });
	await page.waitForFunction(
		async () => {
			const value = await (
				await fetch(new URL("api/export", location.href))
			).json();
			return value.surfaces === 1;
		},
		null,
		{ timeout: 120000 },
	);
}

try {
	await mkdir(evidence, { recursive: true });
	await mkdir(fixtures, { recursive: true });
	const common = { windowsHide: true, timeout: 120000, maxBuffer: 2e6 };
	await run(
		ffmpeg,
		[
			"-y",
			"-v",
			"error",
			"-f",
			"lavfi",
			"-i",
			"color=c=red:s=320x180:r=30:d=2",
			"-f",
			"lavfi",
			"-i",
			"sine=frequency=880:sample_rate=48000:duration=2",
			"-vf",
			"drawbox=x=20+40*t:y=30:w=40:h=40:color=white:t=fill",
			"-c:v",
			"libx264",
			"-pix_fmt",
			"yuv420p",
			"-c:a",
			"aac",
			"-shortest",
			join(fixtures, "video.mp4"),
		],
		common,
	);
	for (const [name, color] of [
		["image", "green"],
		["repair", "blue"],
	])
		await run(
			ffmpeg,
			[
				"-y",
				"-v",
				"error",
				"-f",
				"lavfi",
				"-i",
				`color=c=${color}:s=320x180`,
				"-frames:v",
				"1",
				join(fixtures, `${name}.png`),
			],
			common,
		);
	await run(
		ffmpeg,
		[
			"-y",
			"-v",
			"error",
			"-f",
			"lavfi",
			"-i",
			"aevalsrc=0.12*sin(2*PI*(220+110*floor(t))*t):s=48000:d=4",
			"-c:a",
			"pcm_s16le",
			join(fixtures, "song.wav"),
		],
		common,
	);
	await run(
		ffmpeg,
		[
			"-y",
			"-v",
			"error",
			"-f",
			"lavfi",
			"-i",
			"aevalsrc=0.12*sin(2*PI*1320*t):s=48000:d=2",
			"-c:a",
			"pcm_s16le",
			join(fixtures, "dialogue.wav"),
		],
		common,
	);
	await mark("toolchain", {
		node: process.version,
		ffmpeg: {
			path: ffmpeg,
			sha256: hash(await readFile(ffmpeg)),
			version: (await run(ffmpeg, ["-version"], common)).stdout.split("\n")[0],
		},
		ffprobe: { path: ffprobe, sha256: hash(await readFile(ffprobe)) },
		runtime: {
			path: entry,
			sha256: hash(await readFile(entry)),
			wasmSha256: hash(await readFile(join(delivery, "opencut_wasm_bg.wasm"))),
		},
		surface: JSON.parse(
			await readFile(
				join(delivery, "surface/surface-wasm-package.json"),
				"utf8",
			),
		),
	});
	await startHost();
	const assets = {};
	for (const file of [
		"video.mp4",
		"song.wav",
		"dialogue.wav",
		"image.png",
		"repair.png",
	]) {
		const before = await cli("read");
		assets[file] = (
			await cli(
				"media",
				"import",
				await spec(`import-${file}`, {
					filePath: join(fixtures, file),
					expectedRevision: before.revision,
					idempotencyKey: `import-${file}`,
					...(file.endsWith("png")
						? { image: { mimeType: "image/png", width: 320, height: 180 } }
						: {}),
				}),
			)
		).asset;
	}
	await mark("actual-imported-assets", assets);
	const state = await cli("read"),
		project = state.projectEntity;
	const sceneId = project.sceneState.currentSceneId,
		mainTrack = project.sceneState.scenes.find(
			(s) => s.id === sceneId,
		).mainTrackId;
	const clip = (id, trackId, asset, startTime, duration, editing) => ({
		kind: "create-clip",
		clip: {
			id,
			trackId,
			assetId: asset.id,
			startTime,
			duration,
			trimStart: 0,
			trimEnd: Math.max(0, (asset.duration ?? duration) - duration),
			...(editing ? { editing } : {}),
		},
	});
	await apply("native-layout", [
		{
			kind: "update-project",
			projectId: project.id,
			patch: {
				canvasWidth: 320,
				canvasHeight: 180,
				frameRate: { numerator: 30, denominator: 1 },
			},
		},
		...["song", "dialogue"].map((name) => ({
			kind: "create-track",
			track: {
				id: `${name}-track`,
				kind: "audio",
				name,
				sceneId,
				hidden: false,
				muted: name === "dialogue",
			},
		})),
		clip("shot-video", mainTrack, assets["video.mp4"], 0, 240000, {
			type: "video",
			params: {},
			isSourceAudioEnabled: false,
		}),
		clip("shot-image", mainTrack, assets["image.png"], 240000, 240000, {
			type: "image",
			name: "image.png",
			params: {},
		}),
		clip("original-song", "song-track", assets["song.wav"], 0, 480000, {
			type: "audio",
			name: "song.wav",
			params: {},
		}),
		clip(
			"short-drama-dialogue",
			"dialogue-track",
			assets["dialogue.wav"],
			0,
			240000,
			{ type: "audio", name: "dialogue.wav", params: {} },
		),
	]);
	const saved = await cli("read");
	await mark("native-saved", saved);
	await stopHost();
	await startHost();
	assert.deepEqual(
		await cli("read"),
		saved,
		"Native project did not survive actual Host restart",
	);
	await mark("native-reopened", {
		revision: saved.revision,
		projectSha256: hash(await readFile(join(root, "project/project.json"))),
	});
	browser = await chromium.launch({
		headless: true,
		args: [
			"--use-angle=swiftshader",
			"--enable-unsafe-swiftshader",
			"--autoplay-policy=no-user-gesture-required",
		],
	});
	page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
	page.on("pageerror", (error) => report.errors.push(error.message));
	await openSurface();
	await mark("actual-renderer", {
		chromium: browser.version(),
		executable: chromium.executablePath(),
		executableSha256: hash(await readFile(chromium.executablePath())),
		graphics: await page.evaluate(() => {
			const gl = document.createElement("canvas").getContext("webgl2");
			const ext = gl?.getExtension("WEBGL_debug_renderer_info");
			return {
				renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null,
				videoEncoder: typeof VideoEncoder,
				audioEncoder: typeof AudioEncoder,
			};
		}),
	});
	if (process.argv[4]) {
		await (
			await import(pathToFileURL(resolve(process.argv[4])).href)
		).default({
			cli,
			apply,
			mark,
			evidence,
			root,
			repo,
			page,
			assets,
			ffmpeg,
			ffprobe,
			openSurface,
		});
	} else {
		const mv = await exportAndDecode(
			{ cli, mark, evidence, ffmpeg, ffprobe },
			"mv-muted-video",
			false,
		);
		assert(
			mv.frames[2].mean[1] > 80 && mv.frames[2].mean[2] < 30,
			"Image pixels missing",
		);
		await apply("short-drama-preserve-dialogue", [
			{
				kind: "update-track",
				trackId: "dialogue-track",
				patch: { muted: false },
			},
		]);
		await page.reload();
		await openSurface();
		const preserved = await exportAndDecode(
			{ cli, mark, evidence, ffmpeg, ffprobe },
			"short-drama-preserved-dialogue",
			true,
		);
		const beforeRepair = await cli("read");
		await apply("local-image-repair", [
			{
				kind: "update-clip",
				clipId: "shot-image",
				patch: { assetId: assets["repair.png"].id },
			},
		]);
		const afterRepair = await cli("read");
		for (const key of ["tracks", "assets", "markers"])
			assert.deepEqual(
				afterRepair.entities[key],
				beforeRepair.entities[key],
				`Repair changed unrelated ${key}`,
			);
		assert.deepEqual(
			afterRepair.entities.clips.filter((c) => c.id !== "shot-image"),
			beforeRepair.entities.clips.filter((c) => c.id !== "shot-image"),
		);
		await mark("local-repair-preserved-unrelated-native-nodes", {
			beforeRevision: beforeRepair.revision,
			afterRevision: afterRepair.revision,
			before: beforeRepair,
			after: afterRepair,
		});
		await openSurface();
		const repaired = await exportAndDecode(
			{ cli, mark, evidence, ffmpeg, ffprobe },
			"short-drama-local-repair",
			true,
		);
		assert.deepEqual(
			repaired.frames.slice(0, 2),
			preserved.frames.slice(0, 2),
			"Repair changed decoded unrelated video frames",
		);
		assert(
			repaired.frames[2].mean[2] > 150 && repaired.frames[2].mean[1] < 30,
			"Repaired image pixels missing",
		);
		await apply("short-drama-explicit-mute", [
			{
				kind: "update-track",
				trackId: "dialogue-track",
				patch: { muted: true },
			},
		]);
		await openSurface();
		await exportAndDecode(
			{ cli, mark, evidence, ffmpeg, ffprobe },
			"short-drama-explicit-muted-dialogue",
			false,
		);
	}
	await page.screenshot({ path: join(evidence, "actual-native-editor.png") });
	assert.deepEqual(report.errors, []);
	report.completed = true;
} catch (error) {
	report.failure = { message: error.message, stack: error.stack };
	if (page) {
		report.failure.body = (
			await page
				.locator("body")
				.innerText()
				.catch(() => "")
		).slice(-10000);
		await page
			.screenshot({ path: join(evidence, "failure.png") })
			.catch(() => {});
	}
	console.error(error.message);
	process.exitCode = 1;
} finally {
	await browser?.close();
	await stopHost();
	report.finishedAt = new Date().toISOString();
	await writeFile(
		join(evidence, "report.json"),
		JSON.stringify(report, null, 2),
	);
}

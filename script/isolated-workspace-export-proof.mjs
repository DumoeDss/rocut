import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const repo = resolve(fileURLToPath(new URL("..", import.meta.url)));
const flag = (name) => {
	const index = process.argv.indexOf(name);
	return index < 0 ? undefined : process.argv[index + 1];
};
const root = resolve(
	flag("--root") ?? "C:/tmps/rocut-isolated-export-proof-20261017-c",
);
if (
	!root.replaceAll("\\", "/").startsWith("C:/tmps/rocut-isolated-export-proof-")
)
	throw Error(
		"Proof root must be a dedicated C:/tmps/rocut-isolated-export-proof-* directory",
	);
const delivery = resolve(
	flag("--delivery") ?? "C:/tmps/rocut-workspace-delivery-20261017-17f0354a",
);
const entry = join(delivery, "runtime/rocut.mjs");
const registry = join(root, "targets");
const format = flag("--format") ?? "webm";
if (!["webm", "mp4"].includes(format))
	throw Error("--format must be webm or mp4");
const buttonOnly = process.argv.includes("--button-only");
const report = buttonOnly
	? JSON.parse(await readFile(join(root, "report.json"), "utf8"))
	: { steps: [], errors: [] };
const outputName = `${buttonOnly ? "ui-output" : "output"}.${format}`;
if (process.argv.includes("--finalize")) {
	const saved = JSON.parse(await readFile(join(root, "report.json"), "utf8"));
	let decodeIndex = 0;
	saved.steps = await Promise.all(
		saved.steps
			.filter(
				(step) => !["host-created", "renderer-visible"].includes(step.name),
			)
			.map(async (step) => {
				if (step.name === "independent-full-av-decode" && step.value.stderr) {
					const log = `decode-${++decodeIndex}.log`;
					await writeFile(join(root, log), step.value.stderr);
					return {
						name: step.name,
						value: {
							exitCode: step.value.exitCode,
							log,
							rmsDb: Number(
								step.value.stderr.match(/RMS level dB: (-?[\d.]+)/)?.[1],
							),
							peakDb: Number(
								step.value.stderr.match(/Peak level dB: (-?[\d.]+)/)?.[1],
							),
						},
					};
				}
				if (
					[
						"timeline-created",
						"ui-reverse-saved",
						"same-project-reopened",
					].includes(step.name)
				) {
					const state = step.value.state ?? step.value;
					return {
						name: step.name,
						value: {
							revision: state.revision,
							entities: state.entities,
							projectEntity: state.projectEntity,
						},
					};
				}
				return step;
			}),
	);
	saved.scope = {
		delivery,
		root,
		renderer:
			"Chromium 151.0.7922.34 / ANGLE Vulkan SwiftShader Device (Subzero)",
		output: `${format} requested; actual codecs are recorded by ffprobe; no hardware-GPU claim`,
		editing:
			"Visible reverse switch, save, reopen checked; decoded endpoints favor reversed ordering",
		driverAdjustments: [
			"Region selector disambiguated portal",
			"Properties navigation uses button role",
			"Format accordion must be expanded before radio interaction",
		],
	};
	await writeFile(join(root, "report.json"), JSON.stringify(saved, null, 2));
	for (const child of ["project", "targets", "profile"])
		await rm(join(root, child), { recursive: true, force: true });
	for (const child of [
		"import-short-motion.mp4.json",
		"import-tone.wav.json",
		"layout.json",
		"failure.png",
	])
		await rm(join(root, child), { force: true });
	for (const previous of [
		"C:/tmps/rocut-isolated-export-proof-20261017",
		"C:/tmps/rocut-isolated-export-proof-20261017-b",
	]) {
		if (resolve(previous) !== root)
			await rm(previous, { recursive: true, force: true });
	}
	console.log(
		"Finalized evidence and removed owned project, registry, profiles and earlier attempt directories",
	);
	process.exit(0);
}
const require = createRequire(join(repo, "apps/vite-example/package.json"));
const { chromium } = require("@playwright/test");
let host, context, page;
let target, editorUrl;
async function cli(...args) {
	const result = await run(
		process.execPath,
		[entry, ...args, "--target", target, "--targets-root", registry],
		{ timeout: 120000, maxBuffer: 4e6, windowsHide: true },
	);
	return JSON.parse(result.stdout);
}
async function spec(name, data) {
	const path = join(root, name + ".json");
	await writeFile(path, JSON.stringify(data, null, 2));
	return path;
}
async function state() {
	return cli("read");
}
async function mark(name, value) {
	report.steps.push({ name, value });
	await writeFile(join(root, "report.json"), JSON.stringify(report, null, 2));
	console.log(name);
}
try {
	await mkdir(root, { recursive: true });
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
			registry,
			"--port",
			"0",
		],
		{ windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
	);
	let output = "",
		hostErrors = "";
	host.stdout.on("data", (chunk) => (output += chunk));
	host.stderr.on("data", (chunk) => (hostErrors += chunk));
	for (let count = 0; count < 120 && !output.includes("editorUrl "); count++) {
		if (host.exitCode !== null) throw Error("Host exited: " + hostErrors);
		await new Promise((accept) => setTimeout(accept, 500));
	}
	target = output.match(/target (\S+)/)?.[1];
	editorUrl = output.match(/editorUrl (\S+)/)?.[1];
	if (!target || !editorUrl) throw Error("No host identity: " + hostErrors);
	await mark("host-created", { target, pid: host.pid });
	if (!buttonOnly) {
		const imported = [];
		for (const file of ["short-motion.mp4", "tone.wav"]) {
			const before = await state();
			imported.push(
				await cli(
					"media",
					"import",
					await spec("import-" + file, {
						filePath: join(
							repo,
							"apps/vite-example/public/workspace-fixtures",
							file,
						),
						expectedRevision: before.revision,
						idempotencyKey: "isolated-" + file,
					}),
				),
			);
		}
		await mark("cli-imported", imported);
		const before = await state();
		const sceneId = before.projectEntity.sceneState.currentSceneId;
		const trackId = before.projectEntity.sceneState.scenes.find(
			(scene) => scene.id === sceneId,
		).mainTrackId;
		const duration = Math.min(
			imported[0].asset.duration,
			imported[1].asset.duration,
		);
		await cli(
			"apply",
			await spec("layout", {
				expectedRevision: before.revision,
				idempotencyKey: "isolated-layout",
				operations: [
					{
						kind: "create-track",
						track: {
							id: "proof-audio-track",
							kind: "audio",
							name: "Proof audio",
							hidden: false,
							sceneId,
						},
					},
					...imported.map((item, index) => ({
						kind: "create-clip",
						clip: {
							id: index ? "proof-audio" : "proof-video",
							trackId: index ? "proof-audio-track" : trackId,
							assetId: item.asset.id,
							startTime: 0,
							duration,
							trimStart: 0,
							trimEnd: item.asset.duration - duration,
						},
					})),
				],
			}),
		);
		await mark("timeline-created", { duration, state: await state() });
	}
	context = await chromium.launchPersistentContext(join(root, "profile"), {
		headless: true,
		viewport: { width: 1440, height: 1000 },
		args: [
			"--use-angle=swiftshader",
			"--enable-unsafe-swiftshader",
			"--autoplay-policy=no-user-gesture-required",
		],
	});
	page = context.pages()[0] ?? (await context.newPage());
	page.on("pageerror", (error) => report.errors.push(error.message));
	await page.goto(editorUrl, { waitUntil: "domcontentloaded" });
	await page
		.locator('[data-editor-surface][role="region"]')
		.waitFor({ timeout: 120000 });
	await page.waitForTimeout(2000);
	await mark("renderer-visible", {
		buttons: await page.getByRole("button").allTextContents(),
		body: (await page.locator("body").innerText()).slice(-12000),
	});
	const capabilities = await page.evaluate(async () => {
		const probe = async (type, config) => {
			try {
				return {
					config,
					...(await globalThis[type].isConfigSupported(config)),
				};
			} catch (error) {
				return { config, supported: false, error: error.message };
			}
		};
		return {
			video: await Promise.all(
				["avc1.420028", "avc1.4d0028", "avc1.640028"].map((codec) =>
					probe("VideoEncoder", {
						codec,
						width: 1920,
						height: 1080,
						framerate: 30,
						bitrate: 6000000,
						hardwareAcceleration: "prefer-software",
					}),
				),
			),
			audio: await Promise.all(
				["mp4a.40.2", "opus"].map((codec) =>
					probe("AudioEncoder", {
						codec,
						sampleRate: 48000,
						numberOfChannels: 2,
						bitrate: 192000,
					}),
				),
			),
		};
	});
	await mark("actual-browser-encoder-capabilities", capabilities);
	const clip = page
		.locator('div[class~="absolute"][class~="top-0"][class~="select-none"]')
		.filter({ hasText: "short-motion.mp4" })
		.first();
	await clip.click({ timeout: 30000 });
	if (!buttonOnly) {
		await page.getByRole("button", { name: "速度", exact: true }).click();
		const reverse = page.getByTestId("video-reverse");
		if (await reverse.isDisabled())
			throw Error("Video reverse UI is unsupported");
		await reverse.click();
		await page.getByTestId("project-save").click();
		await page.waitForTimeout(1500);
		await mark("ui-reverse-saved", await state());
		await page.reload({ waitUntil: "domcontentloaded" });
		await page
			.locator('[data-editor-surface][role="region"]')
			.waitFor({ timeout: 120000 });
		await clip.click();
		await page.getByRole("button", { name: "速度", exact: true }).click();
		if ((await reverse.getAttribute("aria-checked")) !== "true")
			throw Error("Reverse did not persist on reopen");
		await page.screenshot({ path: join(root, "reopened.png") });
		await mark("same-project-reopened", await state());
	}
	if (buttonOnly) {
		await page.getByRole("button", { name: "导出", exact: true }).click();
		await page.getByRole("button", { name: "格式", exact: true }).click();
		await page.locator(`#${format}`).click();
		await mark("visible-export-settings", {
			body: (await page.locator("body").innerText()).slice(-6000),
			chromium: context.browser()?.version(),
			args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
			renderer: await page.evaluate(() => {
				const gl = document.createElement("canvas").getContext("webgl2");
				const ext = gl?.getExtension("WEBGL_debug_renderer_info");
				return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null;
			}),
		});
		const downloadPromise = page.waitForEvent("download", { timeout: 120000 });
		await page.getByRole("button", { name: "开始导出", exact: true }).click();
		const download = await downloadPromise;
		await download.saveAs(join(root, outputName));
		await mark("visible-button-export-completed", {
			suggestedFilename: download.suggestedFilename(),
			failure: await download.failure(),
		});
		await page.screenshot({ path: join(root, "ui-exported.png") });
	} else {
		const saved = await state();
		const exported = await cli(
			"export",
			"--revision",
			String(saved.revision),
			"--idempotency-key",
			`isolated-${format}-export`,
			"--format",
			format,
			"--quality",
			"high",
			"--out",
			join(root, outputName),
		);
		await mark("formal-export-completed", exported);
	}
	const ffmpeg = "E:/Software/ffmpeg-6.0-full_build/bin/ffmpeg.exe";
	const ffprobe = "E:/Software/ffmpeg-6.0-full_build/bin/ffprobe.exe";
	const metadata = await run(
		ffprobe,
		[
			"-v",
			"error",
			"-count_frames",
			"-show_streams",
			"-show_format",
			"-of",
			"json",
			join(root, outputName),
		],
		{ timeout: 120000, windowsHide: true },
	);
	await mark("independent-ffprobe", JSON.parse(metadata.stdout));
	const decoded = await run(
		ffmpeg,
		[
			"-v",
			"info",
			"-i",
			join(root, outputName),
			"-map",
			"0:v:0",
			"-map",
			"0:a:0",
			"-af",
			"astats=metadata=1:reset=0",
			"-f",
			"null",
			"-",
		],
		{ timeout: 120000, windowsHide: true, maxBuffer: 2e6 },
	);
	if (!decoded.stderr.match(/RMS level dB: -?\d+\.\d+/))
		throw Error("No finite measured audio RMS");
	await mark("independent-full-av-decode", {
		exitCode: 0,
		stderr: decoded.stderr,
	});
	const frameHashes = await run(
		ffmpeg,
		[
			"-v",
			"error",
			"-i",
			join(root, outputName),
			"-map",
			"0:v:0",
			"-vf",
			"scale=64:36",
			"-f",
			"framemd5",
			"-",
		],
		{ timeout: 120000, windowsHide: true },
	);
	const frames = frameHashes.stdout
		.split("\n")
		.filter((line) => line.startsWith("0,"));
	if (
		frames.length < 2 ||
		new Set(frames.map((line) => line.split(",").at(-1))).size < 2
	)
		throw Error("No decoded motion frames");
	await mark("independent-motion-frame-hashes", { outputName, frames });
	const raw = async (path) =>
		(
			await run(
				ffmpeg,
				[
					"-v",
					"error",
					"-i",
					path,
					"-an",
					"-vf",
					"scale=64:36",
					"-pix_fmt",
					"rgb24",
					"-f",
					"rawvideo",
					"-",
				],
				{
					encoding: "buffer",
					maxBuffer: 4e6,
					timeout: 120000,
					windowsHide: true,
				},
			)
		).stdout;
	const sourceFrames = await raw(
		join(repo, "apps/vite-example/public/workspace-fixtures/short-motion.mp4"),
	);
	const outputFrames = await raw(join(root, outputName));
	const bytesPerFrame = 64 * 36 * 3;
	const ends = (bytes) => [
		bytes.subarray(0, bytesPerFrame),
		bytes.subarray(bytes.length - bytesPerFrame),
	];
	const [sf, sl] = ends(sourceFrames),
		[of, ol] = ends(outputFrames);
	const mse = (a, b) =>
		a.reduce((sum, value, index) => sum + (value - b[index]) ** 2, 0) /
		a.length;
	const forwardError = mse(of, sf) + mse(ol, sl);
	const reverseError = mse(of, sl) + mse(ol, sf);
	await mark("independent-reverse-endpoint-check", {
		outputName,
		sourceFrameCount: sourceFrames.length / bytesPerFrame,
		outputFrameCount: outputFrames.length / bytesPerFrame,
		reverseError,
		forwardError,
		reversed: reverseError < forwardError,
	});
	if (!(reverseError < forwardError))
		throw Error("Decoded output endpoints do not demonstrate reverse order");
	report.completed = true;
	delete report.failure;
} catch (error) {
	report.failure = { message: error.message, stack: error.stack };
	if (page) {
		report.failure.body = await page
			.locator("body")
			.innerText()
			.catch(() => "");
		await page.screenshot({ path: join(root, "failure.png") }).catch(() => {});
	}
	console.error(error.message);
	process.exitCode = 1;
} finally {
	await context?.close();
	if (host && host.exitCode === null) host.kill();
	await rm(join(root, "profile"), { recursive: true, force: true }).catch(
		() => {},
	);
	await writeFile(join(root, "report.json"), JSON.stringify(report, null, 2));
}

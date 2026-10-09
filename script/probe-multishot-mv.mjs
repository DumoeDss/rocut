import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { chromium, createServer } from "./browser-probe-toolchain.mjs";
import { buildNativeAudioExportProbe } from "./native-audio-export-build.mjs";
import { verifyMultishotMv } from "./fixtures/multishot-mv-verify.mjs";
import { parseOverallTimeout } from "./fixtures/multishot-mv-options.mjs";
import {
	artifactBudget,
	readyEndpoint,
	inspectReusableWeb,
} from "./fixtures/multishot-mv-run-support.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const overallTimeoutMs = parseOverallTimeout(process.argv.slice(2));
const isolated = process.env.ROCUT_TEST_WASM_DIRECTORY,
	ffmpeg = process.env.ROCUT_TEST_FFMPEG,
	ffprobe = process.env.ROCUT_TEST_FFPROBE;
if (
	!process.argv[2] ||
	!isolated ||
	!isAbsolute(isolated) ||
	!ffmpeg ||
	!ffprobe
)
	throw Error("Provide private toolchain/WASM and FFmpeg/FFprobe paths");
const artifact = await mkdtemp(join(tmpdir(), "rocut-multishot-mv-"));
const runStarted = Date.now();
let lastMilestone = "starting-private-probe",
	runIdentity = {};
const saveRunStatus = (state, details = {}) =>
	writeFile(
		join(artifact, "run-status.json"),
		JSON.stringify(
			{
				state,
				overallTimeoutMs,
				elapsedMs: Date.now() - runStarted,
				lastMilestone,
				...runIdentity,
				...details,
			},
			null,
			2,
		),
	);
await saveRunStatus("starting");
const traceInner = process.argv.includes("--trace-audio-inner");
const traceAudio = traceInner || process.argv.includes("--trace-audio");
const reuseArtifact = process.argv
	.find((arg) => arg.startsWith("--reuse-web-from="))
	?.slice("--reuse-web-from=".length);
process.env.TEMP = artifact;
process.env.TMP = artifact;
process.env.TMPDIR = artifact;
console.log(JSON.stringify({ artifact, state: "starting-private-probe" }));
const host = spawn(
	"bun",
	[
		"--preload",
		"./script/fixtures/isolated-web-wasm-preload.mjs",
		...(traceAudio
			? ["--preload", "./script/fixtures/multishot-mv-trace-preload.mjs"]
			: []),
		"script/fixtures/multishot-mv-host.ts",
		process.argv[2],
		artifact,
	],
	{
		cwd: root,
		windowsHide: true,
		stdio: ["pipe", "pipe", "pipe"],
		env: {
			...process.env,
			...(traceAudio
				? {
						ROCUT_TEST_MULTISHOT_AUDIO_TRACE: join(
							artifact,
							"audio-trace.jsonl",
						),
					}
				: {}),
			ROCUT_TEST_MULTISHOT_TRACE_INNER: traceInner ? "1" : "0",
		},
	},
);
const exited = new Promise((resolve) => host.once("close", resolve));
let browser,
	server,
	hostReady = false;
try {
	const endpoint = await readyEndpoint(host, artifact);
	hostReady = true;
	const wasmSha256 = createHash("sha256")
		.update(await readFile(join(isolated, "opencut_wasm_bg.wasm")))
		.digest("hex");
	const reusedClient = reuseArtifact
		? await inspectReusableWeb(reuseArtifact, wasmSha256)
		: undefined;
	const output = reusedClient?.root ?? join(artifact, "web");
	if (!reusedClient)
		await buildNativeAudioExportProbe(
			root,
			isolated,
			output,
			"multishot-mv-browser",
		);
	const prepared = {
		artifact,
		overallTimeoutMs,
		traceAudio,
		traceInner,
		reusedClient,
		wasmSha256,
		artifactBytes: await artifactBudget(artifact),
		frames: 150,
		durationSeconds: 6,
	};
	await writeFile(
		join(artifact, "prepared.json"),
		JSON.stringify(prepared, null, 2),
	);
	const client =
		reusedClient ?? (await inspectReusableWeb(artifact, wasmSha256));
	await writeFile(
		join(artifact, "prepared.json"),
		JSON.stringify({ ...prepared, client }, null, 2),
	);
	runIdentity = {
		wasmSha256,
		clientManifestSha256: client.manifestSha256,
		freshClientBuild: !reusedClient,
		reusedClientManifestSha256: reusedClient?.manifestSha256,
	};
	await saveRunStatus("prepared");
	if (process.argv.includes("--prepare-only")) {
		await saveRunStatus("prepared-only");
		console.log(
			JSON.stringify({ ...prepared, state: "prepared-no-browser-executed" }),
		);
	} else {
		server = await createServer({
			root: output,
			configFile: false,
			cacheDir: join(artifact, "vite-cache"),
			logLevel: "error",
			optimizeDeps: { noDiscovery: true, include: [] },
			server: {
				host: "127.0.0.1",
				hmr: false,
				port: 0,
				proxy: { "/api": { target: endpoint } },
			},
		});
		await server.listen();
		browser = await chromium.launch({
			headless: true,
			executablePath: chromium.executablePath(),
		});
		const page = await browser.newPage(),
			errors = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error")
				errors.push(message.text().slice(0, 2000));
			if (message.text().startsWith("multishot:")) {
				lastMilestone = message.text();
				console.log(message.text());
			}
		});
		await page.goto(
			`http://127.0.0.1:${server.httpServer.address().port}/script/fixtures/multishot-mv-browser.html`,
			{ waitUntil: "commit", timeout: 90000 },
		);
		await page.waitForFunction(() => globalThis.__multishotMv, undefined, {
			timeout: overallTimeoutMs,
		});
		const result = await page.evaluate(() => globalThis.__multishotMv);
		if (result.error || errors.length) {
			const checkpoint = await page.evaluate(
				() => globalThis.__multishotMvCheckpoint ?? null,
			);
			await writeFile(
				join(artifact, "failed-browser-result.json"),
				JSON.stringify({ result, errors, checkpoint }, null, 2),
			);
			throw Error(JSON.stringify({ result, errors }));
		}
		assert.deepEqual(result.layerOrderTopToBottom, [
			"foreground",
			"lyrics",
			"remotion",
			"hyperframes",
		]);
		assert.equal(result.reloadedPixelsExact, true);
		const counts = await (await fetch(`${endpoint}/api/counts`)).json();
		assert.ok(
			counts.frames.hyperframes >= 150 && counts.frames.remotion >= 150,
		);
		assert.equal(counts.saves, 1);
		assert.equal(counts.reloads, 1);
		assert.equal(counts.fontLoads, 2);
		assert.equal(counts.audioRequests, 1);
		assert.ok(counts.ordinaryLoads >= 1);
		await writeFile(
			join(artifact, "multishot-mv.webm"),
			Buffer.from(result.bytes),
		);
		await writeFile(join(artifact, "mixed.f32"), Buffer.from(result.pcm));
		await writeFile(
			join(artifact, "native-preview.png"),
			Buffer.from(result.previewPng),
		);
		await writeFile(
			join(artifact, "wrong-layer-order.png"),
			Buffer.from(result.wrongOrder.png),
		);
		for (const snapshot of result.snapshots)
			await writeFile(
				join(artifact, `native-lyrics-${snapshot.frame}.png`),
				Buffer.from(snapshot.png),
			);
		const verification = verifyMultishotMv({
			artifact,
			ffmpeg,
			ffprobe,
			snapshots: result.snapshots,
			wrongOrder: result.wrongOrder,
		});
		const { bytes, pcm, snapshots, wrongOrder, previewPng, ...browserSummary } =
			result;
		await writeFile(
			join(artifact, "browser-result.json"),
			JSON.stringify({ ...browserSummary, errors }, null, 2),
		);
		const summary = {
			passed: true,
			overallTimeoutMs,
			artifact,
			wasmSha256,
			client,
			reusedClient,
			counts,
			...verification,
			...browserSummary,
			videoBytes: bytes.length,
			videoSha256: createHash("sha256")
				.update(Buffer.from(bytes))
				.digest("hex"),
			artifactBytes: await artifactBudget(artifact),
			scope:
				"complete six-second synthetic multishot fixture, native HyperFrames/Remotion/JIZURA/recipe and source+ordinary PCM through real project codec/store and SceneExporter; independent all-frame/audio decode; not installed Electron, a user full-song MV, or performance acceptance",
		};
		await writeFile(
			join(artifact, "verification.json"),
			JSON.stringify(summary, null, 2),
		);
		await saveRunStatus("passed", {
			videoBytes: bytes.length,
			decodedFrames: summary.decodedFrames,
		});
		console.log(
			JSON.stringify(
				{
					passed: true,
					artifact,
					frames: summary.decodedFrames,
					videoBytes: summary.videoBytes,
					artifactBytes: summary.artifactBytes,
					channels: summary.sound.channels,
					wrongOrderRejected: summary.visual.wrongOrderRejected,
				},
				null,
				2,
			),
		);
	}
} catch (error) {
	await writeFile(join(artifact, "failure.txt"), error?.stack ?? String(error));
	await saveRunStatus("failed", { error: error?.message ?? String(error) });
	console.error(error?.stack ?? String(error));
	process.exitCode = 1;
} finally {
	await browser?.close();
	await server?.close();
	if (host.exitCode === null && !host.killed) {
		if (hostReady) host.stdin.end("stop\n");
		else host.kill();
	}
	await exited;
	console.log(JSON.stringify({ artifact, state: "retained-evidence" }));
}

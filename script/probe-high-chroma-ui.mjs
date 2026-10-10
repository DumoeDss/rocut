import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "./browser-probe-toolchain.mjs";
import { prepareEditorDist } from "./fixtures/clouds-editor-build.mjs";
import {
	assertPrivateDirectory,
	closeEditorProbe,
	deadline,
	hostReadiness,
} from "./fixtures/clouds-editor-lifecycle.mjs";
import {
	digest,
	validateHighChromaUiInputs,
} from "./fixtures/high-chroma-ui-inputs.mjs";
import { runHighChromaUiChecks } from "./fixtures/high-chroma-ui-checks.mjs";
import { highChromaUiContract } from "./fixtures/high-chroma-ui-contract.mjs";

const launcherRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [artifactRoot, executablePath, bun, sourceRoot] = process.argv.slice(2);
assert.equal(
	process.argv.length,
	6,
	"Expected artifactRoot Chrome Bun privateSourceRoot",
);
assert(
	[artifactRoot, executablePath, bun, sourceRoot].every(
		(value) => value && isAbsolute(value),
	),
);
assertPrivateDirectory(artifactRoot, "Artifact root");
assertPrivateDirectory(sourceRoot, "Frozen source root");
const ffmpegDirectory = process.env.ROCUT_HIGH_CHROMA_UI_FFMPEG_DIR;
assert(
	ffmpegDirectory && isAbsolute(ffmpegDirectory),
	"Set ROCUT_HIGH_CHROMA_UI_FFMPEG_DIR",
);
const root = resolve(sourceRoot);
const { manifest, manifestBytes, wasmSha256 } =
	await validateHighChromaUiInputs(root, launcherRoot);
const parent = join(artifactRoot, "high-chroma-ui");
await mkdir(parent, { recursive: true });
const artifacts = await mkdtemp(join(parent, "run-"));
const temp = join(artifacts, "temp");
await mkdir(temp);
const editorDist =
	process.env.ROCUT_HIGH_CHROMA_UI_EDITOR_DIST || join(temp, "editor-dist");
assertPrivateDirectory(editorDist, "Editor build");
await writeFile(join(artifacts, "source-manifest.json"), manifestBytes, {
	flag: "wx",
});
const evidence = {
	ok: false,
	mode: "real-ui-and-host-high-chroma-export",
	contract: highChromaUiContract,
	sourceManifestSha256: digest(manifestBytes),
	wasmSha256,
	backend: "private Chromium SwiftShader",
	installedPluginTested: false,
	electronTested: false,
	pixelFidelityTested: false,
	historicalDropletsAcceptanceChanged: false,
	paneRegistrations: [],
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
console.log(JSON.stringify({ phase: "preparing-high-chroma-ui", artifacts }));
let browser,
	browserServer,
	page,
	host,
	exited,
	hostError = "";
try {
	await prepareEditorDist({
		root,
		editorDist,
		temp,
		manifest,
		wasmSha256,
		evidence,
		reuse: Boolean(process.env.ROCUT_HIGH_CHROMA_UI_EDITOR_DIST),
	});
	host = spawn(
		bun,
		[
			"--preload",
			"./script/fixtures/local-wasm-preload.mjs",
			"script/fixtures/high-chroma-ui-host.ts",
			artifacts,
			editorDist,
		],
		{
			cwd: root,
			windowsHide: true,
			stdio: ["pipe", "pipe", "pipe"],
			env,
		},
	);
	exited = new Promise((done) => host.once("exit", done));
	host.stderr.on("data", (chunk) => {
		hostError = (hostError + redact(chunk)).slice(-12000);
	});
	host.stdin.on("error", (error) =>
		evidence.errors.push(redact(error.message)),
	);
	const editorUrl = await hostReadiness(host, () => hostError);
	browserServer = await chromium.launchServer({
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
	browser = await chromium.connect(browserServer.wsEndpoint(), {
		timeout: 30000,
	});
	evidence.browser = browser.version();
	page = await browser.newPage({
		viewport: { width: 1440, height: 1000 },
		deviceScaleFactor: 1,
		acceptDownloads: true,
	});
	await page.route(
		(url) => /^https?:$/.test(url.protocol) && url.hostname !== "127.0.0.1",
		async (route) => {
			evidence.externalRequests.push(new URL(route.request().url()).origin);
			await route.abort();
		},
	);
	page.on("request", (request) => {
		const url = new URL(request.url());
		if (!url.pathname.endsWith("/api/events")) return;
		evidence.paneRegistrations.push({
			exportProtocol: url.searchParams.get("exportProtocol"),
			exportVideoChroma: url.searchParams.get("exportVideoChroma"),
			hasEditorTaskSurface: Boolean(url.searchParams.get("editorTaskSurface")),
		});
	});
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
		evidence.httpFailures.push({
			path: "/" + pathname.slice(new URL(editorUrl).pathname.length),
			status: response.status(),
		});
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
		.locator(
			`[data-testid="timeline-clip"][data-element-id="${highChromaUiContract.clipId}"]`,
		)
		.waitFor({ timeout: 120000 });
	await page.waitForFunction(
		async () => (await (await fetch("api/export")).json()).surfaces === 1,
		undefined,
		{ timeout: 30000 },
	);
	console.log(JSON.stringify({ phase: "high-chroma-ui-attached" }));
	await deadline(
		runHighChromaUiChecks({
			page,
			artifacts,
			evidence,
			request,
			ffmpegDirectory,
		}),
		360000,
		"Real UI and Host high-chroma exports",
	);
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
	assert(evidence.consoleErrors.length <= evidence.httpFailures.length);
	assert(
		evidence.consoleErrors.every(
			(message) =>
				message ===
				"Failed to load resource: the server responded with a status of 404 (Not Found)",
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
	evidence.cleanup = await closeEditorProbe(
		browser,
		browserServer,
		host,
		exited,
	);
	if (evidence.cleanup.errors.length || evidence.cleanup.host?.forced) {
		evidence.ok = false;
		evidence.failure ??= "Owned resources did not close gracefully";
		process.exitCode = 1;
	}
	if (evidence.ok) {
		try {
			assert.equal(host.exitCode, 0, "Host restart verification failed");
			evidence.hostRestart = JSON.parse(
				await readFile(join(artifacts, "closed.json"), "utf8"),
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

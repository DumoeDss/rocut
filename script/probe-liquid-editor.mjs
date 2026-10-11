import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, chromium } from "./browser-probe-toolchain.mjs";
import { runLiquidEditor } from "./fixtures/liquid-editor-checks.mjs";
import { runLiquidEditorExport } from "./fixtures/liquid-editor-export-checks.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [artifactRoot, executablePath, bun] = process.argv.slice(2);
assert.equal(process.argv.length, 5);
assert(
	[artifactRoot, executablePath, bun].every(
		(value) => value && isAbsolute(value),
	),
);
assert(
	!process.env.ROCUT_LIQUID_READBACK_PKG,
	"Editor acceptance uses the normal production WASM only",
);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const manifestBytes = await readFile(join(root, "fixture-source.json"));
const manifest = JSON.parse(manifestBytes);
for (const file of manifest.files)
	assert.equal(
		digest(await readFile(join(root, file.path))),
		file.sha256,
		`Unsynchronized source: ${file.path}`,
	);
const parent = join(artifactRoot, "liquid-editor");
await mkdir(parent, { recursive: true });
const artifacts = await mkdtemp(join(parent, "run-"));
const temp = join(artifacts, "temp");
await mkdir(temp);
const editorDist =
	process.env.ROCUT_LIQUID_EDITOR_DIST || join(temp, "editor-dist");
assert(isAbsolute(editorDist));
const exportSource = process.env.ROCUT_LIQUID_EDITOR_EXPORT_SOURCE_RUN;
if (exportSource) {
	assert(isAbsolute(exportSource));
	assert(
		process.env.ROCUT_LIQUID_EDITOR_DIST,
		"Export reuses the accepted private editor build",
	);
}
const wasmSha256 = digest(
	await readFile(join(root, "rust/wasm/pkg/opencut_wasm_bg.wasm")),
);
await writeFile(join(artifacts, "source-manifest.json"), manifestBytes, {
	flag: "wx",
});
const evidence = {
	ok: false,
	mode: exportSource ? "existing-ui-project-export" : "real-editor-ui-history",
	sourceManifestSha256: digest(manifestBytes),
	wasmSha256,
	backend: "private Chromium SwiftShader",
	installedPluginTested: false,
	electronTested: false,
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
console.log(JSON.stringify({ phase: "preparing-liquid-editor", artifacts }));
let browser,
	page,
	host,
	exited,
	hostError = "";
try {
	if (exportSource) {
		const sourceEvidence = await readFile(join(exportSource, "evidence.json"));
		const accepted = JSON.parse(sourceEvidence);
		assert(accepted.ok && accepted.hostRestart.hostReopenedAfterEdits);
		assert.equal(accepted.wasmSha256, wasmSha256);
		evidence.sourceUiEvidenceSha256 = digest(sourceEvidence);
	}
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
			exportSource
				? "script/fixtures/liquid-editor-export-host.ts"
				: "script/fixtures/liquid-editor-host.ts",
			artifacts,
			editorDist,
			...(exportSource ? [exportSource] : []),
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
			() => reject(Error("Liquid Host startup deadline exceeded")),
			60000,
		);
		host.once("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		host.once("exit", (code) => {
			clearTimeout(timer);
			reject(Error(`Liquid Host exited ${code}: ${hostError}`));
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
	await page.screenshot({ path: join(artifacts, "editor.png") });
	evidence.editorTransport =
		"actual Host staticDir and authenticated URL; attached editor task runner";
	console.log(JSON.stringify({ phase: "liquid-editor-attached" }));
	if (exportSource)
		await runLiquidEditorExport(
			page,
			artifacts,
			evidence,
			request,
			exportSource,
			process.env.ROCUT_LIQUID_EDITOR_FFMPEG_DIR,
		);
	else await runLiquidEditor(page, artifacts, evidence, request);
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
	// The editor preview pipeline cancels in-flight frame renders on rapid UI
	// operations (undo/redo/seek). AbortSignal cancellations surface as console
	// errors without indicating a defect, matching the flame-wrap editor probe
	// policy, so only unexpected console errors fail acceptance here.
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
// End only this completed standalone probe after its owned browser and Host close.
process.exit(process.exitCode ?? 0);

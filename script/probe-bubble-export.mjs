import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, readdir, realpath, rename, lstat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, win32 } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bubbleExportContract as contract, bubbleExportJobs } from "./fixtures/bubble-export-contract.mjs";
import { bubbleExportClips, bubbleExportSource } from "./fixtures/bubble-export-reference.mjs";
import { bubbleExportHash as hash, bubbleExportSave as save, bubbleExportScratch } from "./fixtures/bubble-export-preflight.mjs";
import { blazePipelinePng } from "./probe-blaze-pipeline-png.mjs";
import { blazeEditorRequest, blazeEditorSnapshot, blazeEditorPoll } from "./fixtures/blaze-editor-control.mjs";
import { blazeEditorDeadline, blazeEditorRedact as redact, closeBlazeEditorResources } from "./fixtures/blaze-editor-lifecycle.mjs";
import { observeBlazeEditorExportPage, assertBlazeEditorExportBrowserErrors } from "./fixtures/blaze-editor-export-browser.mjs";
import { runBubbleExportChecks, assertBubbleBootstrapSemantics, assertBubbleExportBaseline } from "./fixtures/bubble-export-checks.mjs";
import { blazeEditorProjectFiles } from "./fixtures/blaze-editor-export-persistence.mjs";

const ownPath = fileURLToPath(import.meta.url);
const json = (bytes) => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
function descendant(path, parent) {
	assert(win32.isAbsolute(path));
	const relative = win32.relative(win32.resolve(parent), win32.resolve(path));
	assert(relative && !relative.startsWith("..") && !win32.isAbsolute(relative), `Path escapes private parent: ${path}`);
}
async function exactPath(path, parent = "C:/tmps") {
	descendant(path, parent);
	assert.equal(win32.resolve(await realpath(path)).toLowerCase(), win32.resolve(path).toLowerCase(), "Redirected private input");
}
async function inventory(directory, prefix = "") {
	const result = [];
	for (const item of await readdir(directory, { withFileTypes: true })) {
		assert(!item.isSymbolicLink(), "Redirected build/package entry");
		const path = join(directory, item.name), relative = prefix + item.name;
		if (item.isDirectory()) result.push(...await inventory(path, relative + "/"));
		else { assert(item.isFile()); result.push({ path: relative, absolute: path, sha256: hash(await readFile(path)) }); }
	}
	return result.sort((a, b) => a.path.localeCompare(b.path, "en"));
}
export function validateBubbleNativeBuildPair(source, compiled) {
	const isBuildInput = (path) => path.startsWith("rust/") || path.startsWith(".cargo/") ||
		["Cargo.toml", "Cargo.lock", "rust-toolchain.toml", "script/build-wasm.mjs", "script/wasm-toolchain.mjs", "script/wasm-package-directory.mjs"].includes(path);
	const select = (manifest) => manifest.files.filter((item) => isBuildInput(item.path)).sort((a, b) => a.path.localeCompare(b.path, "en"));
	const actual = select(source), expected = select(compiled);
	assert(expected.some((item) => item.path === "script/build-wasm.mjs"));
	assert(expected.some((item) => item.path.startsWith("rust/")));
	assert.deepEqual(actual, expected, "Derived source differs from actual compiled Rust/build inputs");
	return expected.length;
}
export function bubbleNativeCompilationManifest(handoff) {
	const frozen = Object.hasOwn(handoff, "sourceFreeze") || Object.hasOwn(handoff, "sourceFreezeSha256");
	const path = frozen ? handoff.sourceFreeze : join(handoff.root, "fixture-source.json");
	const sha256 = frozen ? handoff.sourceFreezeSha256 : handoff.manifestSha256;
	assert(typeof path === "string" && /^[a-f0-9]{64}$/.test(sha256), "Missing actual compilation manifest binding");
	if (frozen) assert.equal(win32.resolve(path).toLowerCase(), win32.resolve(handoff.root, "source-freeze.json").toLowerCase(),
		"Fresh receipt must bind its own immutable source-freeze.json");
	return { path, sha256 };
}
export function validateBubbleRuntimeWasmEntry({ runtime, packageRoot, packageManifest, resolvedEntry }) {
	assert(["node", "bun"].includes(runtime), "Explicit supported Host JavaScript runtime required");
	assert.equal(packageManifest.name, "opencut-wasm");
	assert.deepEqual(packageManifest.exports?.["."], {
		types: "./opencut_wasm.d.ts", bun: "./opencut_wasm_sync.js", default: "./opencut_wasm.js",
	}, "Frozen WASM root export mapping changed");
	assert.deepEqual(Object.keys(packageManifest.exports["."]), ["types", "bun", "default"], "Frozen WASM export condition order changed");
	const condition = runtime === "bun" ? "bun" : "default";
	const expectedEntry = win32.resolve(packageRoot, packageManifest.exports["."][condition]);
	assert.equal(win32.resolve(resolvedEntry).toLowerCase(), expectedEntry.toLowerCase(),
		"Host runtime resolves a different canonical WASM package entry");
	return { runtime, condition, exportTarget: packageManifest.exports["."][condition],
		resolvedEntry: win32.resolve(resolvedEntry) };
}
export async function validateBubbleExportInputs(configPath, { requireDist = true } = {}) {
	await exactPath(configPath);
	const inputs = new Map(), remember = async (path, expected) => {
		const bytes = await readFile(path), digest = hash(bytes);
		if (expected) assert.equal(digest, expected, path);
		inputs.set(resolve(path), digest); return bytes;
	};
	const config = json(await remember(configPath));
	assert.deepEqual(Object.keys(config).sort(), ["snapshot", "manifestSha256", "buildHandoff", "buildHandoffSha256",
		"creatorModule", "creatorSha256", "editorDist", "editorSourceManifest", "editorSourceManifestSha256",
		"executablePath", "bunPath", "artifactParent", "ffmpegDirectory"].sort());
	for (const key of Object.keys(config).filter((key) => key.endsWith("Sha256"))) assert(/^[a-f0-9]{64}$/.test(config[key]), key);
	for (const key of ["snapshot", "buildHandoff", "creatorModule"]) await exactPath(config[key]);
	await bubbleExportScratch(config.artifactParent);
	const relative = win32.relative(config.snapshot, config.artifactParent);
	assert(relative.startsWith("..") || win32.isAbsolute(relative), "Artifacts cannot go inside frozen source");
	for (const key of ["bunPath", "executablePath", "ffmpegDirectory"]) {
		assert(win32.isAbsolute(config[key]), key); await realpath(config[key]);
	}
	for (const name of ["ffmpeg.exe", "ffprobe.exe"]) await remember(join(config.ffmpegDirectory, name));
	await remember(config.bunPath); await remember(config.executablePath);
	const manifest = json(await remember(join(config.snapshot, "fixture-source.json"), config.manifestSha256));
	for (const entry of manifest.files) { descendant(join(config.snapshot, entry.path), config.snapshot); await remember(join(config.snapshot, entry.path), entry.sha256); }
	const handoff = json(await remember(config.buildHandoff, config.buildHandoffSha256));
	assert(handoff.ok); await exactPath(handoff.root);
	const nativeBinding = bubbleNativeCompilationManifest(handoff);
	await exactPath(nativeBinding.path);
	const nativeManifest = json(await remember(nativeBinding.path, nativeBinding.sha256));
	if (win32.resolve(handoff.root).toLowerCase() !== win32.resolve(config.snapshot).toLowerCase()) {
		assert.deepEqual(manifest.nativeBuildParent, { root: handoff.root, manifestSha256: nativeBinding.sha256,
			buildHandoff: config.buildHandoff, buildHandoffSha256: config.buildHandoffSha256 }, "Derived source must declare the actual native build parent");
	}
	const compiledInputCount = validateBubbleNativeBuildPair(manifest, nativeManifest);
	for (const entry of nativeManifest.files) { descendant(join(handoff.root, entry.path), handoff.root); await remember(join(handoff.root, entry.path), entry.sha256); }
	const built = handoff.results.find((item) => item.mode === "default"); assert(built && built.exit === 0 && built.officialUnchanged);
	assert.equal(win32.resolve(built.pkg).toLowerCase(), win32.resolve(join(handoff.root, "rust/wasm/pkg")).toLowerCase());
	await exactPath(built.pkg);
	const packageRoot = join(config.snapshot, "rust/wasm/pkg"); await exactPath(packageRoot);
	const originalPackageFiles = await inventory(built.pkg), packageFiles = await inventory(packageRoot);
	assert.deepEqual(packageFiles.map(({ path, sha256 }) => ({ path, sha256 })), originalPackageFiles.map(({ path, sha256 }) => ({ path, sha256 })), "Derived package differs from actual built default package");
	assert.equal(packageFiles.length, 11);
	assert.deepEqual(packageFiles.map(({ path, sha256 }) => ({ name: path, sha256 })), [...built.files].sort((a, b) => a.name.localeCompare(b.name, "en")));
	for (const item of originalPackageFiles) await remember(item.absolute, item.sha256);
	for (const item of packageFiles) await remember(item.absolute, item.sha256);
	const wasmSha256 = built.files.find((item) => item.name === "opencut_wasm_bg.wasm").sha256;
	const hostRequire = createRequire(join(config.snapshot, "apps/cli/package.json"));
	const runtimeWasmEntry = validateBubbleRuntimeWasmEntry({ runtime: process.versions.bun ? "bun" : "node",
		packageRoot, packageManifest: json(await readFile(join(packageRoot, "package.json"))),
		resolvedEntry: await realpath(hostRequire.resolve("opencut-wasm")) });
	await remember(config.creatorModule, config.creatorSha256);
	await remember(join(dirname(config.creatorModule), "spatial.mjs"));
	// Hash the complete static JS fixture import closure used by this launcher.
	const visit = async (path) => {
		path = resolve(path); if (inputs.has(path)) return;
		const text = new TextDecoder("utf-8", { fatal: true }).decode(await remember(path));
		for (const match of text.matchAll(/(?:from\s*|import\s*)["'](\.[^"']+)["']/g)) await visit(resolve(dirname(path), match[1]));
	};
	await visit(ownPath);
	await visit(join(dirname(ownPath), "browser-probe-toolchain.mjs"));
	const toolRequire = createRequire(join(dirname(ownPath), "../apps/vite-example/package.json"));
	const toolchainEntries = [];
	for (const name of ["@playwright/test", "vite", "vite-plugin-wasm", "vite-plugin-top-level-await"]) {
		const path = toolRequire.resolve(name); await remember(path); toolchainEntries.push({ name, path, sha256: inputs.get(resolve(path)) });
	}
	let editorFiles = [];
	if (requireDist) {
		assert(typeof config.editorDist === "string" && typeof config.editorSourceManifest === "string", "Actual export requires a private Host editorDist and matching editorSourceManifest; pending raster probes are insufficient");
		await exactPath(config.editorDist); await exactPath(config.editorSourceManifest);
		const editorManifest = json(await remember(config.editorSourceManifest, config.editorSourceManifestSha256));
		const production = (value) => value.files.filter((item) => !item.path.startsWith("script/") && !item.path.startsWith("apps/cli/")).sort((a, b) => a.path.localeCompare(b.path, "en"));
		assert.deepEqual(production(editorManifest), production(manifest), "Host editor build production sources do not match frozen snapshot");
		editorFiles = await inventory(config.editorDist);
		assert(editorFiles.some((item) => item.path === "index.html"));
		const wasm = editorFiles.filter((item) => /(?:^|\/)opencut_wasm_bg-[^/]+\.wasm$/.test(item.path));
		assert.equal(wasm.length, 1); assert.equal(wasm[0].sha256, wasmSha256);
		for (const item of editorFiles) await remember(item.absolute, item.sha256);
	} else {
		assert.equal(config.editorDist, null); assert.equal(config.editorSourceManifest, null);
		assert.equal(config.editorSourceManifestSha256, "0".repeat(64));
	}
	return { config, inputs, provenance: { configSha256: inputs.get(resolve(configPath)), sourceManifestSha256: config.manifestSha256,
		nativeBuildRoot: handoff.root, nativeBuildManifestSha256: nativeBinding.sha256, compiledInputCount,
		buildHandoffSha256: config.buildHandoffSha256, wasmSha256, creatorSha256: config.creatorSha256,
		packageFiles, editorFiles, toolchainEntries, runtimeWasmEntry, fixtureFiles: [...inputs].filter(([path]) => path.startsWith(dirname(ownPath))).map(([path, sha256]) => ({ path, sha256 })),
		actualExportRunnable: requireDist } };
}
async function verifyInputs(inputs) {
	for (const [path, expected] of inputs) assert.equal(hash(await readFile(path)), expected, `Input changed: ${path}`);
}
async function hostMode(root, configPath) {
	const { config, inputs, provenance } = await validateBubbleExportInputs(configPath);
	await exactPath(root, config.artifactParent);
	await assert.rejects(lstat(join(root, "project")), { code: "ENOENT" });
	const { startHost } = await import(pathToFileURL(join(config.snapshot, "apps/cli/src/host.ts")).href);
	const { TargetRegistry } = await import(pathToFileURL(join(config.snapshot, "apps/cli/src/target-registry.ts")).href);
	const creator = await import(pathToFileURL(config.creatorModule).href);
	const options = { projectRoot: join(root, "project"), staticDir: config.editorDist, port: 0,
		registry: new TargetRegistry(join(root, "registry")), htmlBrowserExecutable: "", htmlFrameConnectionFile: "" };
	let host; const lifecycle = { hostClosed: false, reopened: false };
	const close = async () => { if (host) { await host.close(); host = undefined; } };
	try {
		host = await startHost(options); let request = blazeEditorRequest(host.editorUrl);
		const author = join(root, "author"); await mkdir(author);
		const png = blazePipelinePng(bubbleExportSource(), contract.width, contract.height), filePath = join(author, "bubble.png");
		await writeFile(filePath, png, { flag: "wx" });
		const { resource } = await request("programmatic/resources/import", { id: "bubble.png", filePath, kind: "image", mimeType: "image/png" });
		assert.equal(resource.sha256, hash(png)); assert.equal(resource.byteLength, png.length);
		const context = await request("context"), clips = bubbleExportClips(creator, resource);
		const result = await request("apply", { expectedRevision: context.revision, operations: [
			{ kind: "update-project", projectId: context.project.id, patch: { name: "Bubble private production export", canvasWidth: 192,
				canvasHeight: 128, frameRate: contract.frameRate, background: { type: "color", color: "#000000" } } },
			{ kind: "create-track", track: { id: contract.trackId, name: contract.trackId, hidden: false, kind: "graphic" } },
			...clips.map((clip) => ({ kind: "create-clip", clip })) ] }); assert(result.accepted);
		const bytes = await readFile(join(root, "project/project.json")), snapshot = await blazeEditorSnapshot(request);
		await rename(author, join(root, "unavailable-author"));
		await close(); host = await startHost(options); request = blazeEditorRequest(host.editorUrl);
		assert.deepEqual(await readFile(join(root, "project/project.json")), bytes); assert.deepEqual(await blazeEditorSnapshot(request), snapshot);
		const verifyResource = async () => {
			const response = await fetch(new URL("api/programmatic/resources/load", host.editorUrl), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(resource), signal: AbortSignal.timeout(15000) });
			assert.equal(response.status, 200); assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
		};
		await verifyResource(); await save(root, "prepared.json", { resource, snapshot, context: await request("context"),
			files: await blazeEditorProjectFiles(join(root, "project")), provenance, authorUnavailable: true });
		await save(root, "project-before-export.json", bytes);
		console.log(JSON.stringify({ editorUrl: host.editorUrl }));
		const command = await new Promise((done) => { process.stdin.once("data", (data) => done(data.toString().trim())); process.stdin.once("end", () => done("stop")); });
		if (command === "verify") {
			const baselineBytes = await readFile(join(root, "project-export-baseline.json"));
			const baseline = json(await readFile(join(root, "export-baseline-observation.json")));
			assert.equal(hash(baselineBytes), baseline.projectSha256); assert.equal(baselineBytes.length, baseline.project.bytes);
			assertBubbleBootstrapSemantics(json(bytes), json(baselineBytes), snapshot, baseline.snapshot);
			const verifyBaseline = async (stage) => {
				const observed = { bytes: await readFile(join(root, "project/project.json")), record: await request("record"),
					snapshot: await blazeEditorSnapshot(request), context: await request("context") };
				assertBubbleExportBaseline(observed, { bytes: baselineBytes, record: baseline.record,
					snapshot: baseline.snapshot, context: baseline.context }, stage);
				return { stage, projectSha256: hash(observed.bytes), record: observed.record,
					snapshot: observed.snapshot, context: observed.context };
			};
			const finalFiles = await blazeEditorProjectFiles(join(root, "project"));
			const beforeClose = await verifyBaseline("before-final-host-close");
			await close(); host = await startHost(options); request = blazeEditorRequest(host.editorUrl);
			const reopened = await verifyBaseline("after-final-host-reopen");
			assert.deepEqual(await blazeEditorProjectFiles(join(root, "project")), finalFiles); await verifyResource();
			await save(root, "reopened-after-export.json", { ok: true, ...reopened, beforeClose, files: finalFiles, resourceStillAvailable: true }); lifecycle.reopened = true;
		}
		await verifyInputs(inputs);
	} catch (error) { lifecycle.failure = redact(error.stack ?? error); throw error; }
	finally { try { await close(); lifecycle.hostClosed = true; } finally { await save(root, "host-lifecycle.json", lifecycle); } }
}
function launchHost(root, configPath, config, env) {
	const args = [ownPath, "--host", root, configPath], child = spawn(config.bunPath, args, { cwd: config.snapshot, env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
	let stdout = "", stderr = "", pending = "";
	const closed = new Promise((done, reject) => { child.once("error", reject); child.once("close", (code, signal) => done({ code, signal })); });
	const ready = new Promise((done, reject) => {
		child.once("error", reject); child.once("close", (code) => reject(Error(`Private Bubble Host closed before ready: ${code}`)));
		child.stdout.setEncoding("utf8").on("data", (text) => { stdout += text; pending += text;
			if (pending.length > 131072) return reject(Error("Host readiness line exceeded bound"));
			let newline; while ((newline = pending.indexOf("\n")) >= 0) { const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
				try { const value = JSON.parse(line); if (value.editorUrl) done(value.editorUrl); } catch { /* Host diagnostic */ } }
		});
	});
	child.stderr.setEncoding("utf8").on("data", (text) => { stderr += text; }); child.stdin.on("error", (error) => { stderr += String(error); });
	return { child, ready: blazeEditorDeadline(ready, 90000, "Bubble Host startup"), closed, command: config.bunPath, args, logs: () => ({ stdout: redact(stdout), stderr: redact(stderr) }) };
}
export async function runBubbleExport(configPath) {
	const { config, inputs, provenance } = await validateBubbleExportInputs(configPath);
	const root = await mkdtemp(join(config.artifactParent, "bubble-production-export-")), temp = join(root, "temp"); await mkdir(temp);
	const env = { ...process.env, TMP: temp, TEMP: temp, TMPDIR: temp, ELFTIA_HTML_FRAME_CONNECTION_FILE: "" };
	const evidence = { ok: false, root, kind: "real-host-bubble-production-export", provenance, contract, plannedJobs: bubbleExportJobs,
		errors: [], consoleErrors: [], httpFailures: [], externalRequests: [], warnings: [], videoExportTested: false };
	let host, browser, server, page, completed = false;
	try {
		host = launchHost(root, configPath, config, env); const editorUrl = await host.ready, request = blazeEditorRequest(editorUrl);
		const { chromium } = await import("./browser-probe-toolchain.mjs");
		server = await chromium.launchServer({ executablePath: config.executablePath, headless: true, env,
			args: ["--no-proxy-server", "--enable-unsafe-webgpu", "--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--use-gl=angle"] });
		browser = await chromium.connect(server.wsEndpoint(), { timeout: 30000 }); evidence.browser = browser.version();
		page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
		await observeBlazeEditorExportPage(page, editorUrl, evidence);
		await page.goto(editorUrl, { waitUntil: "commit", timeout: 90000 });
		await page.locator('[data-testid="timeline-clip"][data-element-id="bubble-export-moving"]').waitFor({ timeout: 120000 });
		await blazeEditorPoll(async () => (await request("export")).surfaces === 1, 60000);
		const creator = await import(pathToFileURL(config.creatorModule).href);
		await blazeEditorDeadline(runBubbleExportChecks({ root, page, request, editorUrl, ffmpegDirectory: config.ffmpegDirectory, creator, evidence }), 660000, "Bubble six real exports");
		assertBlazeEditorExportBrowserErrors(evidence); completed = true;
	} catch (error) { evidence.ok = false; evidence.failure = redact(error.stack ?? error); if (page) await page.screenshot({ path: join(root, "failure.png") }).catch(() => {}); }
	finally {
		evidence.cleanup = await closeBlazeEditorResources({ host, browser, server, verify: completed });
		if (host) { const logs = host.logs(); await writeFile(join(root, "host-stdout.log"), logs.stdout, { flag: "wx", encoding: "utf8" }); await writeFile(join(root, "host-stderr.log"), logs.stderr, { flag: "wx", encoding: "utf8" }); }
	}
	try {
		assert(completed && !evidence.failure); assert(evidence.cleanup.hostClosed && evidence.cleanup.browserClosed && !evidence.cleanup.forced); assert.deepEqual(evidence.cleanup.errors, []);
		const reopened = json(await readFile(join(root, "reopened-after-export.json"))), lifecycle = json(await readFile(join(root, "host-lifecycle.json")));
		assert(reopened.ok && reopened.resourceStillAvailable && lifecycle.reopened && lifecycle.hostClosed && !lifecycle.failure);
		assert.deepEqual(reopened.snapshot, evidence.exportBaseline.snapshot); assert.equal(reopened.projectSha256, evidence.exportBaseline.projectSha256);
		assert.deepEqual(await blazeEditorProjectFiles(join(root, "project")), evidence.exportReadOnly.at(-1).files);
		evidence.hostRestart = reopened; evidence.ok = true;
	} catch (error) { evidence.ok = false; evidence.failure ??= redact(error.stack ?? error); }
	try { await verifyInputs(inputs); evidence.inputHashesUnchanged = true; } catch (error) { evidence.ok = false; evidence.sourceFailure = redact(error.stack ?? error); }
	await save(root, "evidence.json", evidence);
	return { root, ok: evidence.ok, failure: evidence.failure, sourceFailure: evidence.sourceFailure };
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(ownPath)) {
	if (process.argv[2] === "--host") { assert.equal(process.argv.length, 5); await hostMode(process.argv[3], process.argv[4]); }
	else if (["--validate", "--validate-without-dist"].includes(process.argv[2])) {
		assert.equal(process.argv.length, 4); const requireDist = process.argv[2] === "--validate";
		const value = await validateBubbleExportInputs(process.argv[3], { requireDist });
		await verifyInputs(value.inputs); console.log(JSON.stringify({ ok: true, actualExportRunnable: requireDist, provenance: value.provenance }));
	} else { assert.equal(process.argv.length, 3, "Usage: node script/probe-bubble-export.mjs [--validate|--validate-without-dist] <C:/tmps/config.json>");
		const result = await runBubbleExport(process.argv[2]); console.log(JSON.stringify(result)); process.exitCode = result.ok ? 0 : 1; }
}

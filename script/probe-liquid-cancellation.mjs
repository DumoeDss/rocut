import assert from "node:assert/strict";
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
import {
	chromium,
	createServer,
	topLevelAwait,
	wasm,
} from "./browser-probe-toolchain.mjs";
import { liquidDiagnosticWasmRoute } from "./liquid-diagnostic-wasm.mjs";

const argumentsIn = process.argv.slice(2);
assert(
	argumentsIn.length === 4 || argumentsIn.length === 5,
	"Expected snapshot, WASM package, artifact parent, Chromium, optional pipeline mode",
);
const mode = argumentsIn.length === 5 ? argumentsIn.pop() : "boundary";
assert(["boundary", "pipeline"].includes(mode), "Unknown probe mode");
assert(argumentsIn.every(isAbsolute), "All inputs must be absolute paths");
const [root, packageDirectory, parent, executablePath] = await Promise.all(
	argumentsIn.map((path) => realpath(path)),
);
assert(/^c:[/\\]tmps[/\\]/i.test(parent), "Artifacts must stay below C:/tmps");
assert(
	/^c:[/\\]tmps[/\\]/i.test(root),
	"Use an isolated source snapshot under C:/tmps",
);
const artifacts = await mkdtemp(join(parent, "liquid-cancellation-"));
const temp = join(artifacts, "temp");
await mkdir(temp);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const manifestBytes = await readFile(join(root, "fixture-source.json"));
const manifest = JSON.parse(manifestBytes);
const inputs = manifest.files.filter(
	(file) =>
		file.path.startsWith("rust/") ||
		(mode === "pipeline" && file.path.startsWith("packages/")) ||
		file.path.startsWith("script/fixtures/liquid-cancellation-") ||
		file.path ===
			"packages/editor-classic/src/services/renderer/compositor/render-request.ts" ||
		file.path === "script/fixtures/liquid-browser-cases.ts",
);
assert(
	inputs.some(
		(file) => file.path === "script/fixtures/liquid-cancellation-browser.ts",
	),
);
async function verifyInputs() {
	for (const file of inputs) {
		const child = relative(root, join(root, file.path));
		assert(
			child && !child.startsWith("..") && !isAbsolute(child),
			"Invalid manifest path",
		);
		assert.equal(
			hash(await readFile(join(root, file.path))),
			file.sha256,
			file.path,
		);
	}
}
await verifyInputs();
const packageNames = [
	"opencut_wasm.js",
	"opencut_wasm_bg.js",
	"opencut_wasm_bg.wasm",
	"opencut_wasm.d.ts",
	"package.json",
];
const packageHashes = Object.fromEntries(
	await Promise.all(
		packageNames.map(async (name) => [
			name,
			hash(await readFile(join(packageDirectory, name))),
		]),
	),
);
const report = {
	ok: false,
	mode,
	sourceCommit: manifest.sourceCommit,
	sourceWorktreeClean: false,
	snapshot: root,
	manifestSha256: hash(manifestBytes),
	inputs,
	packageDirectory,
	packageHashes,
	console: [],
	pageErrors: [],
	externalRequests: [],
	checks: null,
	browserClosed: false,
	serverClosed: false,
};
const runnerPath = fileURLToPath(import.meta.url);
report.runnerInputs = Object.fromEntries(
	await Promise.all(
		[
			runnerPath,
			join(dirname(runnerPath), "liquid-diagnostic-wasm.mjs"),
			join(dirname(runnerPath), "browser-probe-toolchain.mjs"),
		].map(async (path) => [path, hash(await readFile(path))]),
	),
);
let server, context;
try {
	server = await createServer({
		root,
		configFile: false,
		cacheDir: join(artifacts, "vite-cache"),
		logLevel: "error",
		plugins: [
			wasm(),
			topLevelAwait(),
			await liquidDiagnosticWasmRoute(packageDirectory),
		],
		optimizeDeps:
			mode === "pipeline"
				? {
						entries: ["script/fixtures/liquid-cancellation-pipeline.html"],
						include: ["eventemitter3", "react", "react/jsx-runtime"],
					}
				: { noDiscovery: true, include: [] },
		resolve: {
			alias: { "opencut-wasm": join(packageDirectory, "opencut_wasm.js") },
		},
		server: {
			host: "127.0.0.1",
			port: 0,
			hmr: false,
			fs: {
				allow: [
					root,
					packageDirectory,
					join(dirname(runnerPath), "../node_modules"),
				],
			},
		},
	});
	await server.listen();
	const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
	context = await chromium.launchPersistentContext(join(artifacts, "profile"), {
		headless: true,
		executablePath,
		env: { ...process.env, TEMP: temp, TMP: temp, TMPDIR: temp },
		args: [
			"--no-proxy-server",
			"--enable-unsafe-swiftshader",
			"--use-angle=swiftshader",
			"--use-gl=angle",
			"--disable-webgpu",
		],
	});
	await context.addInitScript(() =>
		Object.defineProperty(Navigator.prototype, "gpu", {
			get: () => undefined,
			configurable: true,
		}),
	);
	const page = await context.newPage();
	report.browserVersion = context.browser()?.version();
	page.on("console", (message) => {
		if (
			["warning", "error"].includes(message.type()) &&
			report.console.length < 40
		)
			report.console.push({ type: message.type(), text: message.text() });
	});
	let rejectPageFailure;
	const pageFailure = new Promise((_, reject) => {
		rejectPageFailure = reject;
	});
	void pageFailure.catch(() => {});
	page.on("pageerror", (error) => {
		report.pageErrors.push(error.message);
		rejectPageFailure(error);
	});
	await page.route("**/*", async (route) => {
		const url = new URL(route.request().url());
		if (/^https?:$/.test(url.protocol) && url.origin !== origin) {
			report.externalRequests.push(url.origin);
			await route.abort();
		} else await route.continue();
	});
	console.log(JSON.stringify({ phase: "browser", artifacts }));
	await Promise.race([
		(async () => {
			await page.goto(
				`${origin}/script/fixtures/liquid-cancellation-${mode === "pipeline" ? "pipeline" : "browser"}.html`,
				{ waitUntil: "commit" },
			);
			await page.waitForFunction(
				() => globalThis.__liquidCancellation,
				undefined,
				{ timeout: 120000 },
			);
		})(),
		pageFailure,
	]);
	report.checks = await page.evaluate(() => globalThis.__liquidCancellation);
	if (mode === "pipeline") {
		const diagnostics = await page.evaluate(
			() => globalThis.__liquidPipelineDiagnostics,
		);
		if (diagnostics) {
			const bytes = JSON.stringify(diagnostics, null, 2) + "\n";
			await writeFile(join(artifacts, "diagnostics.json"), bytes, {
				flag: "wx",
			});
			report.diagnosticsSha256 = hash(bytes);
		}
		const media = await page.evaluate(() => globalThis.__liquidPipelineMedia);
		if (media) {
			assert.equal(typeof media.video, "string");
			const video = Buffer.from(media.video, "base64");
			await writeFile(join(artifacts, "recovery.webm"), video, { flag: "wx" });
			report.recoveryVideo = { bytes: video.length, sha256: hash(video) };
			if (typeof media.expected === "string") {
				const expected = Buffer.from(media.expected, "base64");
				await writeFile(join(artifacts, "expected.rgba"), expected, {
					flag: "wx",
				});
				report.recoveryReference = {
					bytes: expected.length,
					sha256: hash(expected),
				};
			}
			if (typeof media.baseline === "string") {
				const baseline = Buffer.from(media.baseline, "base64");
				await writeFile(join(artifacts, "baseline.rgba"), baseline, {
					flag: "wx",
				});
				report.recoveryBaseline = {
					bytes: baseline.length,
					sha256: hash(baseline),
				};
			}
		}
	}
	assert(report.checks.ok, report.checks.failure);
	assert.equal(report.pageErrors.length, 0, "Browser page errors");
	assert.equal(
		report.externalRequests.length,
		0,
		"Unexpected external requests",
	);
	await verifyInputs();
	for (const name of packageNames)
		assert.equal(
			hash(await readFile(join(packageDirectory, name))),
			packageHashes[name],
			name,
		);
	report.ok = true;
} catch (error) {
	report.failure = error.stack ?? String(error);
} finally {
	try {
		if (context) await context.close();
		report.browserClosed = true;
	} catch (error) {
		report.closeError = String(error);
		report.ok = false;
	}
	try {
		if (server) await server.close();
		report.serverClosed = true;
	} catch (error) {
		report.serverCloseError = String(error);
		report.ok = false;
	}
	await writeFile(
		join(artifacts, "evidence.json"),
		JSON.stringify(report, null, 2) + "\n",
		{ flag: "wx" },
	);
	console.log(
		JSON.stringify({ ok: report.ok, artifacts, failure: report.failure }),
	);
	if (!report.ok) process.exitCode = 1;
}

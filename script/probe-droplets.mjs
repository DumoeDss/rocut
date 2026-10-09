import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
	chromium,
	createServer,
	topLevelAwait,
	wasm,
} from "./browser-probe-toolchain.mjs";
import { liquidDiagnosticWasmRoute as privateWasmRoute } from "./liquid-diagnostic-wasm.mjs";
import {
	assertScratch,
	collectDropletsInputs,
	verifyDropletsInputs,
} from "./probe-droplets-evidence.mjs";
import { saveDropletsJson } from "./probe-droplets-artifacts.mjs";
import {
	captureDroplets,
	dropletsDeadline as deadline,
} from "./probe-droplets-capture.mjs";

const args = process.argv.slice(2);
assert(
	args.length === 4 || args.length === 5,
	"Usage: node script/probe-droplets.mjs <absolute snapshot> <absolute private WASM package> <absolute C:/tmps artifact parent> <absolute Chromium executable> [pipeline]",
);
const mode = args.length === 5 ? args.pop() : "raster";
assert(["raster", "pipeline"].includes(mode), "Unknown probe mode");
assert(args.every(isAbsolute), "All arguments must be absolute paths");
const [root, packageDirectory, parent, executablePath] = await Promise.all(
	args.map((path) => realpath(path)),
);
for (const path of [root, packageDirectory, parent]) assertScratch(path);
for (const immutable of [root, packageDirectory]) {
	const path = relative(immutable, parent);
	assert(
		path.startsWith("..") || isAbsolute(path),
		"Artifact parent must not be inside immutable inputs",
	);
}
const artifacts = await mkdtemp(join(parent, `droplets-${mode}-`));
const temp = join(artifacts, "temp");
const runnerDirectory = dirname(fileURLToPath(import.meta.url));
const report = {
	ok: false,
	kind:
		mode === "pipeline"
			? "droplets-production-pipeline"
			: "droplets-native-raster",
	mode,
	artifacts,
	startedAt: new Date().toISOString(),
	requestedBackend: "webgl",
	console: [],
	pageErrors: [],
	externalRequests: [],
	captureErrors: [],
	checks: null,
	browserClosed: false,
	serverClosed: false,
};
let server, context, page, frozen;
try {
	await mkdir(temp);
	frozen = await collectDropletsInputs(
		root,
		packageDirectory,
		[
			"probe-droplets.mjs",
			"probe-droplets-evidence.mjs",
			"probe-droplets-artifacts.mjs",
			"probe-droplets-capture.mjs",
			"probe-droplets-pipeline-artifacts.mjs",
			"browser-probe-toolchain.mjs",
			"liquid-diagnostic-wasm.mjs",
		].map((name) => join(runnerDirectory, name)),
		mode,
	);
	Object.assign(report, frozen);
	server = await createServer({
		root,
		configFile: false,
		cacheDir: join(artifacts, "vite-cache"),
		logLevel: "error",
		plugins: [
			wasm(),
			topLevelAwait(),
			await privateWasmRoute(packageDirectory),
		],
		optimizeDeps:
			mode === "pipeline"
				? {
						entries: ["script/fixtures/droplets-pipeline.html"],
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
				strict: true,
				allow: [
					root,
					packageDirectory,
					join(runnerDirectory, "../node_modules"),
				],
			},
		},
	});
	await server.listen();
	const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
	report.origin = origin;
	context = await chromium.launchPersistentContext(join(artifacts, "profile"), {
		headless: true,
		executablePath,
		serviceWorkers: "block",
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
	context.setDefaultTimeout(10000);
	await context.route("**/*", async (route) => {
		const url = new URL(route.request().url());
		if (/^https?:$/.test(url.protocol) && url.origin === origin)
			await route.continue();
		else if (["data:", "blob:"].includes(url.protocol)) await route.continue();
		else {
			report.externalRequests.push(url.origin);
			await route.abort();
		}
	});
	page = await context.newPage();
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
	page.on("crash", () => rejectPageFailure(Error("Chromium page crashed")));
	console.log(JSON.stringify({ phase: "browser", artifacts }));
	await Promise.race([
		(async () => {
			await page.goto(
				`${origin}/script/fixtures/${mode === "pipeline" ? "droplets-pipeline.html" : "droplets-browser-probe.html"}?backend=webgl`,
				{ waitUntil: "commit", timeout: 30000 },
			);
			await page.waitForFunction(
				(key) => Reflect.get(globalThis, key) !== undefined,
				mode === "pipeline" ? "__dropletsPipeline" : "__dropletsResult",
				{ timeout: 120000 },
			);
		})(),
		pageFailure,
	]);
} catch (error) {
	report.failure = error.stack ?? String(error);
} finally {
	await captureDroplets(page, artifacts, mode, report);
	try {
		if (context) await deadline(context.close(), 15000, "Browser close");
		report.browserClosed = true;
	} catch (error) {
		report.browserCloseError = String(error);
	}
	try {
		if (server) await deadline(server.close(), 15000, "Server close");
		report.serverClosed = true;
	} catch (error) {
		report.serverCloseError = String(error);
	}
	if (frozen) report.postRunVerification = await verifyDropletsInputs(frozen);
	report.ok =
		!report.failure &&
		report.checks?.ok === true &&
		report.checks.backend === "webgl" &&
		Boolean(mode === "pipeline" ? report.pipelineMedia : report.rawFrames) &&
		!report.captureErrors.length &&
		!report.pageErrors.length &&
		!report.externalRequests.length &&
		report.browserClosed &&
		report.serverClosed &&
		report.postRunVerification?.ok === true;
	report.finishedAt = new Date().toISOString();
	await saveDropletsJson(artifacts, "evidence.json", report);
	console.log(
		JSON.stringify({
			ok: report.ok,
			artifacts,
			failure:
				report.failure ??
				report.checks?.failure ??
				report.checks?.errors ??
				report.captureErrors,
		}),
	);
	if (!report.ok) process.exitCode = 1;
}

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
	cloudsScratch,
	collectCloudsInputs,
	verifyCloudsInputs,
} from "./probe-clouds-evidence.mjs";
import {
	captureClouds,
	cloudsDeadline,
	saveCloudsJson,
} from "./probe-clouds-artifacts.mjs";
import { captureCloudsPipeline } from "./probe-clouds-pipeline-artifacts.mjs";
import { cloudsSourceGuard } from "./probe-clouds-source-guard.mjs";

const args = process.argv.slice(2);
assert(
	args.length === 4 || args.length === 5,
	"Usage: node script/probe-clouds.mjs <absolute C:/tmps snapshot> <absolute C:/tmps private WASM package> <absolute C:/tmps artifact parent> <absolute Chromium executable> [raster|pipeline]",
);
const mode = args.length === 5 ? args.pop() : "raster";
assert(["raster", "pipeline"].includes(mode), "Unknown Clouds probe mode");
assert(args.every(isAbsolute), "Clouds input paths must be absolute");
const [root, packageDirectory, parent, executablePath] = await Promise.all(
	args.map((path) => realpath(path)),
);
for (const path of [root, packageDirectory, parent]) cloudsScratch(path);
for (const immutable of [root, packageDirectory]) {
	const path = relative(immutable, parent);
	assert(
		path.startsWith("..") || isAbsolute(path),
		"Artifact parent must not be inside immutable Clouds inputs",
	);
}
const artifacts = await mkdtemp(join(parent, `clouds-${mode}-`)),
	temp = join(artifacts, "temp");
const runnerDirectory = dirname(fileURLToPath(import.meta.url));
const report = {
	ok: false,
	kind:
		mode === "pipeline" ? "clouds-production-pipeline" : "clouds-native-raster",
	mode,
	artifacts,
	startedAt: new Date().toISOString(),
	requestedBackend: "webgl",
	console: [],
	pageErrors: [],
	httpErrors: [],
	externalRequests: [],
	captureErrors: [],
	checks: null,
	browserClosed: false,
	serverClosed: false,
};
let server, context, page, frozen, sourceGuard;
try {
	await mkdir(temp);
	frozen = await collectCloudsInputs(
		root,
		packageDirectory,
		[
			"probe-clouds.mjs",
			"probe-clouds-evidence.mjs",
			"probe-clouds-artifacts.mjs",
			"probe-clouds-pipeline-artifacts.mjs",
			"probe-clouds-contract.mjs",
			"probe-clouds-source-guard.mjs",
			"browser-probe-toolchain.mjs",
			"liquid-diagnostic-wasm.mjs",
		].map((name) => join(runnerDirectory, name)),
		mode,
	);
	Object.assign(report, frozen);
	sourceGuard = cloudsSourceGuard(frozen, dirname(runnerDirectory));
	server = await createServer({
		root,
		configFile: false,
		cacheDir: join(artifacts, "vite-cache"),
		logLevel: "error",
		plugins: [
			sourceGuard.plugin,
			wasm(),
			topLevelAwait(),
			await privateWasmRoute(packageDirectory),
		],
		optimizeDeps:
			mode === "pipeline"
				? {
						entries: ["script/fixtures/clouds-pipeline.html"],
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
		if (
			(/^https?:$/.test(url.protocol) && url.origin === origin) ||
			["data:", "blob:"].includes(url.protocol)
		)
			await route.continue();
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
			report.console.length < 64
		)
			report.console.push({ type: message.type(), text: message.text() });
	});
	page.on("response", (response) => {
		if (response.status() >= 400)
			report.httpErrors.push({
				url: response.url(),
				status: response.status(),
			});
	});
	let rejectPage;
	const failure = new Promise((_, reject) => {
		rejectPage = reject;
	});
	void failure.catch(() => {});
	page.on("pageerror", (error) => {
		report.pageErrors.push(error.message);
		rejectPage(error);
	});
	page.on("crash", () => rejectPage(Error("Clouds browser page crashed")));
	console.log(JSON.stringify({ phase: `${mode}-browser`, artifacts }));
	await Promise.race([
		(async () => {
			await page.goto(
				`${origin}/script/fixtures/${mode === "pipeline" ? "clouds-pipeline.html" : "clouds-browser-probe.html"}?backend=webgl`,
				{ waitUntil: "commit", timeout: 30000 },
			);
			await page.waitForFunction(
				(key) => Reflect.get(globalThis, key) !== undefined,
				mode === "pipeline" ? "__cloudsPipeline" : "__cloudsResult",
				{ timeout: 120000 },
			);
		})(),
		failure,
	]);
} catch (error) {
	report.failure = error.stack ?? String(error);
} finally {
	await (mode === "pipeline" ? captureCloudsPipeline : captureClouds)(
		page,
		artifacts,
		report,
	);
	try {
		if (context)
			await cloudsDeadline(context.close(), 15000, "Clouds browser close");
		report.browserClosed = true;
	} catch (error) {
		report.browserCloseError = String(error);
	}
	try {
		if (server)
			await cloudsDeadline(server.close(), 15000, "Clouds server close");
		report.serverClosed = true;
	} catch (error) {
		report.serverCloseError = String(error);
	}
	if (frozen) report.postRunVerification = await verifyCloudsInputs(frozen);
	report.loadedInputs = Object.fromEntries(sourceGuard?.loaded ?? []);
	report.ok =
		!report.failure &&
		report.checks?.ok === true &&
		report.checks.backend === "webgl" &&
		(mode === "pipeline"
			? report.checks.nativeHandlesGone === true &&
				Array.isArray(report.checks.cleanupErrors) &&
				report.checks.cleanupErrors.length === 0
			: report.checks.gpuDisposed && report.checks.queryFreed) &&
		Boolean(mode === "pipeline" ? report.pipelineMedia : report.rawFrames) &&
		!report.captureErrors.length &&
		!report.pageErrors.length &&
		!report.httpErrors.length &&
		!report.externalRequests.length &&
		!report.console.some((message) => message.type === "error") &&
		report.browserClosed &&
		report.serverClosed &&
		report.postRunVerification?.ok === true;
	report.finishedAt = new Date().toISOString();
	await saveCloudsJson(artifacts, "evidence.json", report);
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

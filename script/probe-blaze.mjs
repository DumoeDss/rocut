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
	blazeScratch,
	collectBlazeInputs,
	verifyBlazeInputs,
} from "./probe-blaze-evidence.mjs";
import {
	captureBlaze,
	blazeDeadline,
	saveBlazeJson,
} from "./probe-blaze-artifacts.mjs";
import { blazeSourceGuard } from "./probe-blaze-source-guard.mjs";

const args = process.argv.slice(2);
assert(
	args.length === 4,
	"Usage: node script/probe-blaze.mjs <absolute C:/tmps derived snapshot> <absolute C:/tmps private WASM package> <absolute C:/tmps artifact parent> <absolute Chromium executable>",
);
assert(args.every(isAbsolute), "Blaze inputs must be absolute paths");
const [root, packageDirectory, parent, executablePath] = await Promise.all(
	args.map((path) => realpath(path)),
);
for (const path of [root, packageDirectory, parent]) blazeScratch(path);
for (const immutable of [root, packageDirectory]) {
	const path = relative(immutable, parent);
	assert(
		path.startsWith("..") || isAbsolute(path),
		"Artifacts cannot be inside immutable Blaze inputs",
	);
}
const artifacts = await mkdtemp(join(parent, "blaze-raster-")),
	temp = join(artifacts, "temp");
const runnerDirectory = dirname(fileURLToPath(import.meta.url));
const report = {
	ok: false,
	kind: "blaze-native-raster",
	mode: "raster",
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
	frozen = await collectBlazeInputs(
		root,
		packageDirectory,
		[
			"probe-blaze.mjs",
			"probe-blaze-evidence.mjs",
			"probe-blaze-artifacts.mjs",
			"probe-blaze-contract.mjs",
			"probe-blaze-source-guard.mjs",
			"browser-probe-toolchain.mjs",
			"liquid-diagnostic-wasm.mjs",
		].map((name) => join(runnerDirectory, name)),
	);
	Object.assign(report, frozen);
	sourceGuard = blazeSourceGuard(frozen, dirname(runnerDirectory));
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
		optimizeDeps: { noDiscovery: true, include: [] },
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
	page.on("crash", () => rejectPage(Error("Blaze browser page crashed")));
	console.log(JSON.stringify({ phase: "raster-browser", artifacts }));
	await Promise.race([
		(async () => {
			await page.goto(
				`${origin}/script/fixtures/blaze-browser-probe.html?backend=webgl`,
				{ waitUntil: "commit", timeout: 30000 },
			);
			await page.waitForFunction(
				() => Reflect.get(globalThis, "__blazeResult") !== undefined,
				null,
				{ timeout: 180000 },
			);
		})(),
		failure,
	]);
} catch (error) {
	report.failure = error.stack ?? String(error);
} finally {
	await captureBlaze(page, artifacts, report);
	try {
		if (context)
			await blazeDeadline(context.close(), 15000, "Blaze browser close");
		report.browserClosed = true;
	} catch (error) {
		report.browserCloseError = String(error);
	}
	try {
		if (server)
			await blazeDeadline(server.close(), 15000, "Blaze server close");
		report.serverClosed = true;
	} catch (error) {
		report.serverCloseError = String(error);
	}
	if (frozen) report.postRunVerification = await verifyBlazeInputs(frozen);
	report.loadedInputs = Object.fromEntries(sourceGuard?.loaded ?? []);
	report.ok =
		!report.failure &&
		report.checks?.ok === true &&
		report.checks.backend === "webgl" &&
		report.checks.gpuDisposed &&
		report.checks.queryFreed &&
		report.rawComplete === true &&
		!report.captureErrors.length &&
		!report.pageErrors.length &&
		!report.httpErrors.length &&
		!report.externalRequests.length &&
		!report.console.some((message) => message.type === "error") &&
		report.browserClosed &&
		report.serverClosed &&
		report.postRunVerification?.ok === true;
	report.finishedAt = new Date().toISOString();
	await saveBlazeJson(artifacts, "evidence.json", report);
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

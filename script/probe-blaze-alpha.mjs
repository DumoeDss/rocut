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
import { liquidDiagnosticWasmRoute } from "./liquid-diagnostic-wasm.mjs";
import {
	alphaScratch,
	alphaSourceGuard,
	collectAlphaInputs,
	verifyAlphaInputs,
} from "./probe-blaze-alpha-evidence.mjs";
import {
	alphaDeadline,
	captureAlpha,
	saveAlphaJson,
} from "./probe-blaze-alpha-artifacts.mjs";

const args = process.argv.slice(2);
assert(
	[4, 5].includes(args.length),
	"Usage: node probe-blaze-alpha.mjs <C:/tmps derived snapshot> <C:/tmps private WASM package> <C:/tmps artifact parent> <Chromium executable> [--native-readback]",
);
assert(args.length === 4 || args[4] === "--native-readback");
const nativeReadback = args.length === 5;
assert(args.slice(0, 4).every(isAbsolute));
const [root, packageDirectory, parent] = await Promise.all(
	args.slice(0, 3).map(alphaScratch),
);
const executablePath = await realpath(args[3]);
for (const input of [root, packageDirectory]) {
	const tail = relative(input, parent);
	assert(
		tail.startsWith("..") || isAbsolute(tail),
		"Artifacts must not be written into frozen inputs",
	);
}
const directory = dirname(fileURLToPath(import.meta.url));
const artifacts = await mkdtemp(join(parent, "blaze-alpha-calibration-"));
const temp = join(artifacts, "temp");
const report = {
	ok: false,
	kind: "independent-alpha-calibration-not-Blaze-acceptance",
	nativeReadback,
	artifacts,
	startedAt: new Date().toISOString(),
	console: [],
	pageErrors: [],
	httpErrors: [],
	externalRequests: [],
	captureErrors: [],
	checks: null,
	browserClosed: false,
	serverClosed: false,
};
let server, context, page, frozen, guard;
try {
	await mkdir(temp);
	frozen = await collectAlphaInputs(root, packageDirectory, directory);
	Object.assign(report, frozen);
	guard = alphaSourceGuard(frozen);
	server = await createServer({
		root,
		configFile: false,
		cacheDir: join(artifacts, "vite-cache"),
		logLevel: "error",
		plugins: [
			guard.plugin,
			wasm(),
			topLevelAwait(),
			await liquidDiagnosticWasmRoute(packageDirectory),
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
				allow: [root, packageDirectory, join(directory, "../node_modules")],
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
	let fail;
	const failure = new Promise((_, reject) => {
		fail = reject;
	});
	void failure.catch(() => {});
	page.on("pageerror", (error) => {
		report.pageErrors.push(error.message);
		fail(error);
	});
	page.on("crash", () => fail(Error("Calibration page crashed")));
	console.log(
		JSON.stringify({
			phase: "independent-alpha-calibration",
			artifacts,
			nativeReadback,
		}),
	);
	await Promise.race([
		failure,
		(async () => {
			await page.goto(
				`${origin}/script/fixtures/blaze-alpha-probe.html?nativeReadback=${Number(nativeReadback)}`,
				{ waitUntil: "commit", timeout: 30000 },
			);
			await page.waitForFunction(
				() => Reflect.get(globalThis, "__alphaResult") !== undefined,
				null,
				{ timeout: 60000 },
			);
		})(),
	]);
} catch (error) {
	report.failure = error.stack ?? String(error);
} finally {
	await captureAlpha(page, artifacts, report);
	try {
		if (context) await alphaDeadline(context.close(), 15000, "browser close");
		report.browserClosed = true;
	} catch (error) {
		report.browserCloseError = String(error);
	}
	try {
		if (server) await alphaDeadline(server.close(), 15000, "server close");
		report.serverClosed = true;
	} catch (error) {
		report.serverCloseError = String(error);
	}
	if (frozen) report.postRunVerification = await verifyAlphaInputs(frozen);
	report.loadedInputs = Object.fromEntries(guard?.loaded ?? []);
	report.ok =
		!report.failure &&
		report.checks?.ok === true &&
		report.checks.backend === "webgl" &&
		report.checks.nativeReadback === nativeReadback &&
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
	await saveAlphaJson(artifacts, "evidence.json", report);
	console.log(
		JSON.stringify({
			ok: report.ok,
			artifacts,
			nativeReadback,
			failure:
				report.failure ??
				report.checks?.failure ??
				report.checks?.errors ??
				report.captureErrors,
		}),
	);
	if (!report.ok) process.exitCode = 1;
}

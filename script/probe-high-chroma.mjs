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
import { saveDropletsJson } from "./probe-droplets-artifacts.mjs";
import { dropletsDeadline } from "./probe-droplets-capture.mjs";
import {
	assertScratch,
	verifyDropletsInputs,
} from "./probe-droplets-evidence.mjs";
import { saveHighChromaMedia } from "./probe-high-chroma-artifacts.mjs";
import {
	highChromaSpecs,
	historical420,
} from "./probe-high-chroma-contract.mjs";
import { collectHighChromaInputs } from "./probe-high-chroma-evidence.mjs";
import { highChromaSourceGuard } from "./probe-high-chroma-source-guard.mjs";

const args = process.argv.slice(2);
assert(
	args.length === 6,
	"Usage: probe-high-chroma <absolute C:/tmps snapshot> <absolute private WASM pkg> <absolute C:/tmps artifact parent> <absolute Chromium> <droplets-192x128-30|solid-sequence-640x360-24> <default|420|444>",
);
const [caseId, mode] = args.splice(4);
assert(Object.hasOwn(highChromaSpecs, caseId));
assert(["default", "420", "444"].includes(mode));
assert(caseId === "droplets-192x128-30" || mode === "444");
assert(args.every(isAbsolute));
const [snapshot, packageDirectory, parent, executablePath] = await Promise.all(
	args.map((path) => realpath(path)),
);
for (const path of [snapshot, packageDirectory, parent]) assertScratch(path);
for (const immutable of [snapshot, packageDirectory]) {
	const path = relative(immutable, parent);
	assert(
		path.startsWith("..") || isAbsolute(path),
		"Artifacts must not overlap immutable inputs",
	);
}
const artifacts = await mkdtemp(join(parent, `high-chroma-${mode}-`));
const temp = join(artifacts, "temp"),
	runner = dirname(fileURLToPath(import.meta.url));
await mkdir(temp);
const report = {
	kind: "high-chroma-production-pipeline",
	caseId,
	mode,
	artifacts,
	ok: false,
	accepted: false,
	preservedHistoricalFailure: false,
	startedAt: new Date().toISOString(),
	console: [],
	pageErrors: [],
	httpErrors: [],
	externalRequests: [],
	captureErrors: [],
	importOnlyWarmup: [],
	browserClosed: false,
	serverClosed: false,
};
let server, context, page, frozen, guard;
const runnerNames = [
	"probe-high-chroma.mjs",
	"probe-high-chroma-contract.mjs",
	"probe-high-chroma-artifacts.mjs",
	"probe-high-chroma-evidence.mjs",
	"probe-high-chroma-source-guard.mjs",
	"probe-high-chroma-metrics.mjs",
	"probe-high-chroma-decode.mjs",
	"probe-droplets-evidence.mjs",
	"probe-droplets-artifacts.mjs",
	"probe-droplets-capture.mjs",
	"probe-droplets-pipeline-artifacts.mjs",
	"probe-droplets-metrics.mjs",
	"browser-probe-toolchain.mjs",
	"liquid-diagnostic-wasm.mjs",
];
try {
	frozen = await collectHighChromaInputs(
		snapshot,
		packageDirectory,
		runnerNames.map((name) => join(runner, name)),
	);
	Object.assign(report, frozen);
	guard = highChromaSourceGuard(frozen, dirname(runner));
	server = await createServer({
		root: snapshot,
		configFile: false,
		logLevel: "error",
		cacheDir: join(artifacts, "vite-cache"),
		plugins: [
			guard.plugin,
			wasm(),
			topLevelAwait(),
			await liquidDiagnosticWasmRoute(packageDirectory),
		],
		optimizeDeps: {
			entries: ["script/fixtures/high-chroma-pipeline.html"],
			include: ["eventemitter3", "react", "react/jsx-runtime"],
		},
		resolve: {
			alias: { "opencut-wasm": join(packageDirectory, "opencut_wasm.js") },
		},
		server: {
			host: "127.0.0.1",
			port: 0,
			hmr: false,
			fs: {
				strict: true,
				allow: [snapshot, packageDirectory, join(runner, "../node_modules")],
			},
		},
	});
	await server.listen();
	const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
	report.origin = origin;
	context = await chromium.launchPersistentContext(join(artifacts, "profile"), {
		executablePath,
		headless: true,
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
	report.browserVersion = context.browser()?.version();
	await context.route("**/*", async (route) => {
		const url = new URL(route.request().url());
		if (url.origin === origin || ["data:", "blob:"].includes(url.protocol))
			await route.continue();
		else {
			report.externalRequests.push(url.origin);
			await route.abort();
		}
	});
	for (let attempt = 1; attempt <= 2; attempt++) {
		const warmPage = await context.newPage();
		const warm = {
			attempt,
			console: [],
			httpErrors: [],
			pageErrors: [],
			ready: false,
		};
		report.importOnlyWarmup.push(warm);
		warmPage.on("console", (msg) => {
			if (["error", "warning"].includes(msg.type()))
				warm.console.push({ type: msg.type(), text: msg.text() });
		});
		warmPage.on("response", (response) => {
			if (response.status() >= 400)
				warm.httpErrors.push({
					url: response.url(),
					status: response.status(),
				});
		});
		let reject;
		const failure = new Promise((_, rejectPromise) => {
			reject = rejectPromise;
		});
		void failure.catch(() => {});
		warmPage.on("pageerror", (error) => {
			warm.pageErrors.push(error.message);
			reject(error);
		});
		try {
			await Promise.race([
				(async () => {
					await warmPage.goto(
						`${origin}/script/fixtures/high-chroma-pipeline.html?chroma=warmup`,
						{ waitUntil: "commit", timeout: 30000 },
					);
					await warmPage.waitForFunction(
						() => Reflect.get(globalThis, "__highChromaWarmup")?.ready === true,
						undefined,
						{ timeout: 60000 },
					);
				})(),
				failure,
			]);
			warm.ready = true;
		} catch (error) {
			warm.failure = error.stack ?? String(error);
		} finally {
			await warmPage.close();
			warm.pageClosed = true;
		}
		if (warm.ready) break;
	}
	assert(
		report.importOnlyWarmup.at(-1).ready,
		"Import-only preparation failed; no export attempted",
	);
	page = await context.newPage();
	page.on("console", (message) => {
		if (["error", "warning"].includes(message.type()))
			report.console.push({ type: message.type(), text: message.text() });
	});
	page.on("response", (response) => {
		if (response.status() >= 400)
			report.httpErrors.push({
				url: response.url(),
				status: response.status(),
			});
	});
	let reject;
	const failure = new Promise((_, rejectPromise) => {
		reject = rejectPromise;
	});
	void failure.catch(() => {});
	page.on("pageerror", (error) => {
		report.pageErrors.push(error.message);
		reject(error);
	});
	page.on("crash", () => reject(Error("High-chroma browser page crashed")));
	console.log(
		JSON.stringify({ phase: "formal-scene-exporter", artifacts, caseId, mode }),
	);
	await Promise.race([
		(async () => {
			await page.goto(
				`${origin}/script/fixtures/high-chroma-pipeline.html?backend=webgl&case=${caseId}&chroma=${mode}`,
				{ waitUntil: "commit", timeout: 30000 },
			);
			await page.waitForFunction(
				() => Reflect.get(globalThis, "__highChromaPipeline") !== undefined,
				undefined,
				{ timeout: 120000 },
			);
		})(),
		failure,
	]);
} catch (error) {
	report.failure = error.stack ?? String(error);
} finally {
	if (page && !page.isClosed()) {
		for (const [field, global] of [
			["checks", "__highChromaPipeline"],
			["decoded", "__highChromaDecode"],
			["rawMedia", "__highChromaMedia"],
		]) {
			try {
				report[field] = await dropletsDeadline(
					page.evaluate((key) => Reflect.get(globalThis, key) ?? null, global),
					5000,
					`Capture ${global}`,
				);
			} catch (error) {
				report.captureErrors.push(String(error));
			}
		}
		if (report.rawMedia) {
			try {
				report.media = await saveHighChromaMedia(artifacts, report.rawMedia);
			} catch (error) {
				report.captureErrors.push(error.stack ?? String(error));
				await saveDropletsJson(
					artifacts,
					"unverified-media.json",
					report.rawMedia,
				);
			}
			delete report.rawMedia;
		}
	}
	try {
		if (context)
			await dropletsDeadline(
				context.close(),
				15000,
				"Close high-chroma browser",
			);
		report.browserClosed = true;
	} catch (error) {
		report.browserCloseError = String(error);
	}
	try {
		if (server)
			await dropletsDeadline(server.close(), 15000, "Close high-chroma Vite");
		report.serverClosed = true;
	} catch (error) {
		report.serverCloseError = String(error);
	}
	if (frozen) report.postRunVerification = await verifyDropletsInputs(frozen);
	report.loadedInputs = Object.fromEntries(guard?.loaded ?? []);
	try {
		assert(
			report.checks && report.decoded && report.media,
			"Missing complete checks/decoded/media evidence",
		);
		assert.equal(report.checks.caseId, caseId);
		assert.equal(report.checks.requestedVideoChroma, mode);
		if (mode === "444") {
			assert.equal(report.checks.ok, true);
			assert.equal(report.decoded.accepted, true);
			report.accepted = true;
		} else {
			assert.equal(
				report.checks.ok,
				false,
				"Default/420 historical failure must remain visible",
			);
			assert.equal(report.decoded.accepted, false);
			assert.equal(report.media.files.video.sha256, historical420.videoSha256);
			assert.deepEqual(
				report.decoded.metrics
					.filter((item) => !item.accepted)
					.map((item) => item.index),
				historical420.browserFailedFrames,
			);
			report.preservedHistoricalFailure = true;
		}
	} catch (error) {
		report.expectationFailure = error.stack ?? String(error);
	}
	report.ok =
		!report.failure &&
		!report.expectationFailure &&
		Boolean(report.accepted || report.preservedHistoricalFailure) &&
		report.checks?.backend === "webgl" &&
		report.checks?.nativeHandlesGone === true &&
		Array.isArray(report.checks?.cleanupErrors) &&
		report.checks.cleanupErrors.length === 0 &&
		!report.captureErrors.length &&
		!report.pageErrors.length &&
		!report.httpErrors.length &&
		!report.externalRequests.length &&
		!report.console.some((item) => item.type === "error") &&
		report.browserClosed &&
		report.serverClosed &&
		report.postRunVerification?.ok === true;
	report.finishedAt = new Date().toISOString();
	await saveDropletsJson(artifacts, "evidence.json", report);
	console.log(
		JSON.stringify({
			artifacts,
			ok: report.ok,
			accepted: report.accepted,
			preservedHistoricalFailure: report.preservedHistoricalFailure,
			failure:
				report.failure ?? report.expectationFailure ?? report.captureErrors,
		}),
	);
	if (!report.ok) process.exitCode = 1;
}

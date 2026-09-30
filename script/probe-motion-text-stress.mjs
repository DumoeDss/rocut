#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";
import { createServer } from "vite";
import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";

import { emitProbeReport, probeReportMode } from "./probe-report-output.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPORT_PATH = join(ROOT, "docs/motion-text/s09-stress-probe.json");
const WASM_PATH = join(ROOT, "rust/wasm/pkg/opencut_wasm_bg.wasm");
const CHECK_ONLY = probeReportMode().checkOnly;
const TICKS_PER_SECOND = 120_000;
const CONFIG = Object.freeze({
	width: 1280,
	height: 720,
	previewBudgetMs: 33.33,
	exportWidth: 320,
	exportHeight: 180,
	cancelAfterFrames: 5,
	mutationSamples: 40,
	mutationBudgetMs: 300,
});
const FIXTURES = Object.freeze([
	{
		id: "F04",
		cueCount: 120,
		duration: 3 * 60 * TICKS_PER_SECOND,
		sampleCount: 180,
		seed: 4_004,
	},
	{
		id: "F05",
		cueCount: 600,
		duration: 8 * 60 * TICKS_PER_SECOND,
		sampleCount: 240,
		seed: 5_005,
	},
]);

function strictJson(path) {
	return JSON.parse(
		new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path)),
	);
}

function validateReport(report) {
	if (report.schemaVersion !== 1) {
		throw new Error("Motion-text stress report schemaVersion must be 1");
	}
	if (
		report.config?.width !== CONFIG.width ||
		report.config?.height !== CONFIG.height ||
		report.config?.previewBudgetMs !== CONFIG.previewBudgetMs ||
		report.config?.exportWidth !== CONFIG.exportWidth ||
		report.config?.exportHeight !== CONFIG.exportHeight ||
		report.config?.cancelAfterFrames !== CONFIG.cancelAfterFrames ||
		report.config?.mutationSamples !== CONFIG.mutationSamples ||
		report.config?.mutationBudgetMs !== CONFIG.mutationBudgetMs
	) {
		throw new Error(
			"Motion-text stress report uses an unexpected configuration",
		);
	}
	if (report.source?.canonicalWasm?.sha256 !== wasmIdentity().sha256) {
		throw new Error("Motion-text stress report uses a stale canonical WASM");
	}
	if (
		!Array.isArray(report.results) ||
		report.results.length !== FIXTURES.length
	) {
		throw new Error("Motion-text stress report must cover F04 and F05");
	}
	for (const fixture of FIXTURES) {
		const result = report.results.find((entry) => entry.id === fixture.id);
		if (
			result?.cueCount !== fixture.cueCount ||
			result.duration !== fixture.duration ||
			result.samples !== fixture.sampleCount ||
			result.cutCount < fixture.cueCount ||
			result.seekParity !== true ||
			result.pixels?.nonTransparentPixels <= 0 ||
			!Number.isFinite(result.createMs) ||
			!Number.isFinite(result.seekDrawMs?.p95)
		) {
			throw new Error(
				`Motion-text stress report has invalid ${fixture.id} evidence`,
			);
		}
		if (result.seekDrawMs.p95 > CONFIG.previewBudgetMs) {
			throw new Error(
				`${fixture.id} seek/draw p95 ${result.seekDrawMs.p95} ms exceeds ${CONFIG.previewBudgetMs} ms`,
			);
		}
	}
	const mutation = report.results.find(
		(entry) => entry.id === "F04",
	)?.localMutation;
	if (
		mutation?.samples !== CONFIG.mutationSamples ||
		mutation.visibleSamples !== CONFIG.mutationSamples ||
		mutation.revisionDelta !== CONFIG.mutationSamples ||
		mutation.distinctFingerprints < 2 ||
		mutation.pixels?.nonTransparentPixels <= 0 ||
		!Number.isFinite(mutation.planMs?.p95) ||
		!Number.isFinite(mutation.drawMs?.p95) ||
		!Number.isFinite(mutation.totalMs?.p95) ||
		mutation.totalMs.p95 > CONFIG.mutationBudgetMs
	) {
		throw new Error(
			"Motion-text stress report lacks a valid F04 local-mutation budget",
		);
	}
	const completed = report.exportProbe?.selectedRange;
	if (
		completed?.frames !== 60 ||
		completed.progressEvents < completed.frames ||
		completed.bufferBytes <= 0 ||
		completed.fileType !== "ftyp" ||
		!Number.isFinite(completed.elapsedMs)
	) {
		throw new Error("Motion-text stress report lacks a valid selected export");
	}
	const cancelled = report.exportProbe?.fullRangeCancellation;
	if (
		cancelled?.totalFrames !== 14_400 ||
		cancelled.cancelAfterFrames !== CONFIG.cancelAfterFrames ||
		cancelled.progressEvents !== CONFIG.cancelAfterFrames ||
		cancelled.cancelledEvents !== 1 ||
		cancelled.resultWasNull !== true ||
		!Number.isFinite(cancelled.elapsedMs)
	) {
		throw new Error(
			"Motion-text stress report lacks a valid full-range cancel",
		);
	}
}

function wasmIdentity() {
	const bytes = readFileSync(WASM_PATH);
	return {
		bytes: statSync(WASM_PATH).size,
		sha256: createHash("sha256").update(bytes).digest("hex"),
	};
}

if (CHECK_ONLY) {
	const report = strictJson(REPORT_PATH);
	validateReport(report);
	console.log(
		`motion-text stress probe: PASS (${report.results.map((entry) => `${entry.id}=${entry.cueCount} cues`).join(", ")})`,
	);
	process.exit(0);
}

const server = await createServer({
	root: ROOT,
	logLevel: "error",
	plugins: [wasm(), topLevelAwait()],
	resolve: {
		alias: {
			"opencut-wasm": join(ROOT, "rust/wasm/pkg/opencut_wasm.js"),
		},
	},
	server: { host: "127.0.0.1", port: 0, strictPort: false },
});
let browser;
try {
	await server.listen();
	const address = server.httpServer?.address();
	if (
		address === null ||
		typeof address === "string" ||
		address === undefined
	) {
		throw new Error("Vite did not expose a local port");
	}
	browser = await chromium.launch({
		headless: true,
		args: ["--enable-precise-memory-info", "--js-flags=--expose-gc"],
	});
	const page = await browser.newPage({
		viewport: { width: CONFIG.width, height: CONFIG.height },
	});
	const pageErrors = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("requestfailed", (request) =>
		pageErrors.push(
			`${request.method()} ${request.url()}: ${request.failure()?.errorText ?? "request failed"}`,
		),
	);
	await page.goto(
		`http://127.0.0.1:${address.port}/script/fixtures/motion-text-stress-probe.html`,
	);
	await page.waitForFunction(
		() => typeof globalThis.__probeMotionTextStress === "function",
	);
	const result = await page.evaluate(
		async ({ fixtures, config }) =>
			globalThis.__probeMotionTextStress({ fixtures, config }),
		{ fixtures: FIXTURES, config: CONFIG },
	);
	if (pageErrors.length > 0) throw new Error(pageErrors.join("\n"));
	const report = {
		schemaVersion: 1,
		generatedBy: "script/probe-motion-text-stress.mjs",
		source: { canonicalWasm: wasmIdentity() },
		environment: {
			browser: await browser.version(),
			userAgent: result.userAgent,
			hasPreciseHeap: result.hasPreciseHeap,
		},
		config: CONFIG,
		results: result.results,
		exportProbe: result.exportProbe,
	};
	validateReport(report);
	emitProbeReport({ report, reportPath: REPORT_PATH });
} finally {
	await browser?.close();
	await server.close();
}

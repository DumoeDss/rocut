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
const REPORT_PATH = join(ROOT, "docs/motion-text/s09-full-export.json");
const WASM_PATH = join(ROOT, "rust/wasm/pkg/opencut_wasm_bg.wasm");
const CHECK_ONLY = probeReportMode().checkOnly;
const TICKS_PER_SECOND = 120_000;
const FIXTURE = Object.freeze({
	id: "F05",
	cueCount: 600,
	duration: 8 * 60 * TICKS_PER_SECOND,
	seed: 5_005,
});
const CONFIG = Object.freeze({
	exportWidth: 320,
	exportHeight: 180,
	progressIntervalFrames: 600,
});

function strictJson(path) {
	return JSON.parse(
		new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path)),
	);
}

function wasmIdentity() {
	const bytes = readFileSync(WASM_PATH);
	return {
		bytes: statSync(WASM_PATH).size,
		sha256: createHash("sha256").update(bytes).digest("hex"),
	};
}

function sameJson(left, right) {
	return JSON.stringify(left) === JSON.stringify(right);
}

function validateReport(report) {
	if (
		report.schemaVersion !== 1 ||
		!sameJson(report.source?.canonicalWasm, wasmIdentity()) ||
		!sameJson(report.fixture, FIXTURE) ||
		!sameJson(report.config, CONFIG)
	) {
		throw new Error("Full F05 export report source or configuration is stale");
	}
	if (
		report.result?.fixture?.id !== FIXTURE.id ||
		report.result.fixture.cueCount !== FIXTURE.cueCount ||
		report.result.fixture.cutCount !== FIXTURE.cueCount * 2 ||
		report.result.fixture.duration !== FIXTURE.duration
	) {
		throw new Error("Full F05 export report has invalid fixture evidence");
	}
	const expectedFrames = (FIXTURE.duration / TICKS_PER_SECOND) * 30;
	const completed = report.result.export;
	if (
		completed?.frames !== expectedFrames ||
		completed.progressEvents < expectedFrames ||
		completed.completeEvents !== 1 ||
		completed.errorEvents !== 0 ||
		completed.cancelledEvents !== 0 ||
		!Number.isFinite(completed.elapsedMs) ||
		completed.elapsedMs <= 0 ||
		completed.bufferBytes <= 8 ||
		completed.fileType !== "ftyp" ||
		!/^[0-9a-f]{64}$/.test(completed.sha256)
	) {
		throw new Error("Full F05 export did not complete with a valid MP4");
	}
	const fontRuntime = report.result.fontRuntime;
	if (
		fontRuntime?.cachedFonts < 1 ||
		fontRuntime.loadedFaces < 1 ||
		fontRuntime.pendingLoads !== 0 ||
		fontRuntime.disposed !== false
	) {
		throw new Error("Full F05 export lacks valid offline-font evidence");
	}
}

if (CHECK_ONLY) {
	const report = strictJson(REPORT_PATH);
	validateReport(report);
	console.log(
		`motion-text full export: PASS (${report.result.export.frames} frames, ${report.result.export.bufferBytes} bytes, ${report.result.export.elapsedMs} ms)`,
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
	browser = await chromium.launch({ headless: true });
	const page = await browser.newPage({
		viewport: { width: CONFIG.exportWidth, height: CONFIG.exportHeight },
	});
	const pageErrors = [];
	page.on("console", (message) => {
		if (message.type() === "log") console.error(message.text());
	});
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
		() => typeof globalThis.__probeMotionTextFullExport === "function",
	);
	const result = await page.evaluate(
		async ({ fixture, config }) =>
			globalThis.__probeMotionTextFullExport({ fixture, config }),
		{ fixture: FIXTURE, config: CONFIG },
	);
	if (pageErrors.length > 0) throw new Error(pageErrors.join("\n"));
	const report = {
		schemaVersion: 1,
		generatedBy: "script/probe-motion-text-full-export.mjs",
		source: { canonicalWasm: wasmIdentity() },
		environment: {
			browser: await browser.version(),
			userAgent: await page.evaluate(() => navigator.userAgent),
		},
		fixture: FIXTURE,
		config: CONFIG,
		result,
	};
	validateReport(report);
	emitProbeReport({ report, reportPath: REPORT_PATH });
} finally {
	await browser?.close();
	await server.close();
}

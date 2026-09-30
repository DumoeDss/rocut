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
const REPORT_PATH = join(ROOT, "docs/motion-text/s09-non-motion-export.json");
const WASM_PATH = join(ROOT, "rust/wasm/pkg/opencut_wasm_bg.wasm");
const CHECK_ONLY = probeReportMode().checkOnly;
const CONFIG = Object.freeze({
	width: 320,
	height: 180,
	fps: Object.freeze({ numerator: 30, denominator: 1 }),
	duration: 120_000,
	audioSampleRate: 48_000,
	sampleTimes: Object.freeze([0, 60_000, 119_999]),
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
		!sameJson(report.config, CONFIG)
	) {
		throw new Error(
			"Non-motion export report source or configuration is stale",
		);
	}
	const result = report.result;
	if (
		!Array.isArray(result?.samples) ||
		result.samples.length !== CONFIG.sampleTimes.length ||
		result.samples.some((sample) => sample.nonBlackPixels <= 0) ||
		new Set(result.samples.map((sample) => sample.digest)).size !==
			CONFIG.sampleTimes.length
	) {
		throw new Error("Non-motion scene lacks distinct visible frame evidence");
	}
	const expectedFrames =
		(CONFIG.duration / 120_000) *
		(CONFIG.fps.numerator / CONFIG.fps.denominator);
	if (
		result.video?.frameRequests < expectedFrames + CONFIG.sampleTimes.length ||
		result.video.distinctTimes < expectedFrames ||
		result.video.minimumTime !== 0 ||
		result.video.maximumTime <= 0
	) {
		throw new Error("Non-motion scene lacks video-frame evidence");
	}
	const completed = result.export;
	if (
		completed?.frames !== expectedFrames ||
		completed.progressEvents < expectedFrames ||
		completed.completeEvents !== 1 ||
		completed.errorEvents !== 0 ||
		!Number.isFinite(completed.elapsedMs) ||
		completed.elapsedMs <= 0 ||
		completed.bufferBytes <= 8 ||
		completed.fileType !== "ftyp" ||
		completed.hasVideoHandler !== true ||
		completed.hasAudioHandler !== true ||
		!/^[0-9a-f]{64}$/.test(completed.sha256)
	) {
		throw new Error("Non-motion SceneExporter MP4 evidence is invalid");
	}
}

if (CHECK_ONLY) {
	const report = strictJson(REPORT_PATH);
	validateReport(report);
	console.log(
		`non-motion export: PASS (${report.result.export.frames} frames, video+text+graphic+audio, ${report.result.export.bufferBytes} bytes)`,
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
		`http://127.0.0.1:${address.port}/script/fixtures/non-motion-export-probe.html`,
	);
	await page.waitForFunction(
		() => typeof globalThis.__probeNonMotionExport === "function",
	);
	const result = await page.evaluate(
		async (config) => globalThis.__probeNonMotionExport(config),
		CONFIG,
	);
	if (pageErrors.length > 0) throw new Error(pageErrors.join("\n"));
	const report = {
		schemaVersion: 1,
		generatedBy: "script/probe-non-motion-export.mjs",
		source: { canonicalWasm: wasmIdentity() },
		environment: {
			browser: await browser.version(),
			userAgent: await page.evaluate(() => navigator.userAgent),
		},
		config: CONFIG,
		result,
	};
	validateReport(report);
	emitProbeReport({ report, reportPath: REPORT_PATH });
} finally {
	await browser?.close();
	await server.close();
}

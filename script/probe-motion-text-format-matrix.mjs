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
const REPORT_PATH = join(ROOT, "docs/motion-text/s09-format-matrix.json");
const CATALOG_PATH = join(ROOT, "docs/motion-text/jizura-preset-catalog.json");
const WASM_PATH = join(ROOT, "rust/wasm/pkg/opencut_wasm_bg.wasm");
const CHECK_ONLY = probeReportMode().checkOnly;
const TICKS_PER_SECOND = 120_000;
const PRESET = Object.freeze({ group: "layout", id: "perspective" });
const FORMATS = Object.freeze(
	[
		["16x9-24", "16:9", 320, 180, 24, 1],
		["16x9-25", "16:9", 320, 180, 25, 1],
		["16x9-30", "16:9", 320, 180, 30, 1],
		["16x9-60", "16:9", 320, 180, 60, 1],
		["16x9-30000-1001", "16:9", 320, 180, 30_000, 1_001],
		["9x16-24", "9:16", 180, 320, 24, 1],
		["9x16-25", "9:16", 180, 320, 25, 1],
		["9x16-30", "9:16", 180, 320, 30, 1],
		["9x16-60", "9:16", 180, 320, 60, 1],
		["9x16-30000-1001", "9:16", 180, 320, 30_000, 1_001],
		["1x1-24", "1:1", 240, 240, 24, 1],
		["1x1-25", "1:1", 240, 240, 25, 1],
		["1x1-30", "1:1", 240, 240, 30, 1],
		["1x1-60", "1:1", 240, 240, 60, 1],
		["1x1-30000-1001", "1:1", 240, 240, 30_000, 1_001],
	].map(([id, aspect, width, height, numerator, denominator]) =>
		Object.freeze({
			id,
			aspect,
			width,
			height,
			fps: Object.freeze({ numerator, denominator }),
		}),
	),
);
const CONFIG = Object.freeze({
	duration: 6 * TICKS_PER_SECOND,
	seed: 20_260_928,
	previewText: "ROCUT FORMAT\nF06 MATRIX",
	samplePositions: Object.freeze([0.2, 0.5, 0.8]),
	exportFrameLimit: 6,
	formats: FORMATS,
});

function strictJson(path) {
	return JSON.parse(
		new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path)),
	);
}

function fileIdentity(path) {
	const bytes = readFileSync(path);
	return {
		bytes: statSync(path).size,
		sha256: createHash("sha256").update(bytes).digest("hex"),
	};
}

function sameJson(left, right) {
	return JSON.stringify(left) === JSON.stringify(right);
}

function authoritativePreset() {
	const catalog = strictJson(CATALOG_PATH);
	const matches = catalog.entries.filter(
		(entry) => entry.group === PRESET.group && entry.id === PRESET.id,
	);
	if (matches.length !== 1) {
		throw new Error(
			`Catalog must contain exactly one ${PRESET.group}:${PRESET.id} entry`,
		);
	}
	const entry = matches[0];
	return {
		catalog,
		entry: {
			group: entry.group,
			id: entry.id,
			name: entry.name,
			pack: entry.pack,
			sourceFile: entry.sourceFile,
		},
	};
}

function ticksPerFrame(fps) {
	return Math.round((TICKS_PER_SECOND * fps.denominator) / fps.numerator);
}

function validateReport(report) {
	const { catalog, entry } = authoritativePreset();
	if (report.schemaVersion !== 1) {
		throw new Error("Motion-text format matrix schemaVersion must be 1");
	}
	if (!sameJson(report.config, CONFIG) || !sameJson(report.preset, entry)) {
		throw new Error("Motion-text format matrix uses an unexpected fixture");
	}
	if (!sameJson(report.source?.canonicalWasm, fileIdentity(WASM_PATH))) {
		throw new Error("Motion-text format matrix uses a stale canonical WASM");
	}
	if (
		!sameJson(
			report.source?.canonicalCatalog?.identity,
			fileIdentity(CATALOG_PATH),
		) ||
		report.source.canonicalCatalog.schemaVersion !== catalog.schemaVersion ||
		report.source.canonicalCatalog.totalEntries !== catalog.counts.total
	) {
		throw new Error("Motion-text format matrix uses a stale preset catalog");
	}
	if (
		!Array.isArray(report.results) ||
		report.results.length !== FORMATS.length
	) {
		throw new Error("Motion-text format matrix must cover all 15 formats");
	}

	const exportDigests = new Set();
	const thirtyFpsFrameDigests = new Set();
	for (const format of FORMATS) {
		const result = report.results.find(
			(candidate) => candidate.formatId === format.id,
		);
		if (
			!result ||
			result.aspect !== format.aspect ||
			result.width !== format.width ||
			result.height !== format.height ||
			!sameJson(result.fps, format.fps)
		) {
			throw new Error(`Missing or stale format result for ${format.id}`);
		}
		if (
			!Array.isArray(result.factory?.diagnostics) ||
			result.factory.diagnostics.length !== 0 ||
			result.factory.cueCount < 2 ||
			result.factory.cutCount < 2 ||
			result.factory.appliedCutCount !== result.factory.eligibleCutCount
		) {
			throw new Error(`Invalid canonical factory result for ${format.id}`);
		}
		const expectedDuration =
			CONFIG.exportFrameLimit * ticksPerFrame(format.fps);
		if (
			result.window?.duration !== expectedDuration ||
			!Number.isInteger(result.window.startTime) ||
			result.window.startTime < 0
		) {
			throw new Error(`Invalid export window for ${format.id}`);
		}
		const pixelCount = format.width * format.height;
		if (
			!Array.isArray(result.frames?.samples) ||
			result.frames.samples.length !== CONFIG.samplePositions.length ||
			!result.frames.samples.every(
				(sample) =>
					Number.isInteger(sample.time) &&
					sample.nonBlackPixels > 0 &&
					sample.nonBlackPixels <= pixelCount &&
					sample.nonTransparentPixels > 0 &&
					sample.nonTransparentPixels <= pixelCount,
			) ||
			!/^[0-9a-f]{64}$/u.test(result.frames.combinedSha256)
		) {
			throw new Error(`Invalid visible-frame evidence for ${format.id}`);
		}
		if (
			result.export?.frames !== CONFIG.exportFrameLimit ||
			result.export.progressEvents < CONFIG.exportFrameLimit ||
			result.export.completeEvents !== 1 ||
			result.export.errorEvents !== 0 ||
			!Number.isFinite(result.export.elapsedMs) ||
			result.export.elapsedMs < 0 ||
			result.export.bufferBytes <= 8 ||
			result.export.fileType !== "ftyp" ||
			!/^[0-9a-f]{64}$/u.test(result.export.sha256)
		) {
			throw new Error(`Invalid MP4 evidence for ${format.id}`);
		}
		if (
			result.fontRuntime?.cachedFonts < 1 ||
			result.fontRuntime.loadedFaces < 1 ||
			result.fontRuntime.pendingLoads !== 0 ||
			result.fontRuntime.disposed !== false
		) {
			throw new Error(`Invalid offline-font evidence for ${format.id}`);
		}
		exportDigests.add(result.export.sha256);
		if (format.fps.numerator === 30 && format.fps.denominator === 1) {
			thirtyFpsFrameDigests.add(result.frames.combinedSha256);
		}
	}
	if (exportDigests.size !== FORMATS.length) {
		throw new Error("Every F06 format must produce a distinct MP4");
	}
	if (thirtyFpsFrameDigests.size !== 3) {
		throw new Error("The three F06 aspect ratios must have distinct frames");
	}
	const expectedSummary = {
		formats: report.results.length,
		encodedFrames: report.results.reduce(
			(total, result) => total + result.export.frames,
			0,
		),
		completeEvents: report.results.reduce(
			(total, result) => total + result.export.completeEvents,
			0,
		),
		errorEvents: report.results.reduce(
			(total, result) => total + result.export.errorEvents,
			0,
		),
		bufferBytes: report.results.reduce(
			(total, result) => total + result.export.bufferBytes,
			0,
		),
	};
	if (!sameJson(report.summary, expectedSummary)) {
		throw new Error("Motion-text format matrix summary is inconsistent");
	}
}

if (CHECK_ONLY) {
	const report = strictJson(REPORT_PATH);
	validateReport(report);
	console.log(
		`motion-text format matrix: PASS (${report.results.length} formats, ${report.summary.encodedFrames} frames)`,
	);
	process.exit(0);
}

const { catalog, entry } = authoritativePreset();
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
	const page = await browser.newPage({ viewport: { width: 320, height: 320 } });
	const pageErrors = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("requestfailed", (request) =>
		pageErrors.push(
			`${request.method()} ${request.url()}: ${request.failure()?.errorText ?? "request failed"}`,
		),
	);
	await page.goto(
		`http://127.0.0.1:${address.port}/script/fixtures/motion-text-export-matrix-probe.html`,
	);
	await page.waitForFunction(
		() => typeof globalThis.__probeMotionTextExportMatrix === "function",
	);
	const probed = await page.evaluate(
		async ({ selectedEntry, config }) => {
			const results = [];
			for (const format of config.formats) {
				const probe = await globalThis.__probeMotionTextExportMatrix({
					entries: [selectedEntry],
					config: {
						width: format.width,
						height: format.height,
						fps: format.fps,
						duration: config.duration,
						seed: config.seed,
						previewText: config.previewText,
						samplePositions: config.samplePositions,
						exportFrameLimit: config.exportFrameLimit,
					},
				});
				const value = probe.results[0];
				results.push({
					formatId: format.id,
					aspect: format.aspect,
					width: format.width,
					height: format.height,
					fps: format.fps,
					fontRuntime: probe.fontRuntime,
					factory: value.factory,
					window: value.window,
					frames: value.frames,
					export: value.export,
				});
			}
			return { results, userAgent: navigator.userAgent };
		},
		{ selectedEntry: entry, config: CONFIG },
	);
	if (pageErrors.length > 0) throw new Error(pageErrors.join("\n"));
	const report = {
		schemaVersion: 1,
		generatedBy: "script/probe-motion-text-format-matrix.mjs",
		source: {
			canonicalWasm: fileIdentity(WASM_PATH),
			canonicalCatalog: {
				identity: fileIdentity(CATALOG_PATH),
				schemaVersion: catalog.schemaVersion,
				totalEntries: catalog.counts.total,
			},
		},
		environment: {
			browser: await browser.version(),
			userAgent: probed.userAgent,
		},
		preset: entry,
		config: CONFIG,
		summary: {
			formats: probed.results.length,
			encodedFrames: probed.results.reduce(
				(total, result) => total + result.export.frames,
				0,
			),
			completeEvents: probed.results.reduce(
				(total, result) => total + result.export.completeEvents,
				0,
			),
			errorEvents: probed.results.reduce(
				(total, result) => total + result.export.errorEvents,
				0,
			),
			bufferBytes: probed.results.reduce(
				(total, result) => total + result.export.bufferBytes,
				0,
			),
		},
		results: probed.results,
	};
	validateReport(report);
	emitProbeReport({ report, reportPath: REPORT_PATH });
} finally {
	await browser?.close();
	await server.close();
}

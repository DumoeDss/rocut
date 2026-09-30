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
const REPORT_PATH = join(ROOT, "docs/motion-text/s09-export-matrix.json");
const CATALOG_PATH = join(ROOT, "docs/motion-text/jizura-preset-catalog.json");
const WASM_PATH = join(ROOT, "rust/wasm/pkg/opencut_wasm_bg.wasm");
const CHECK_ONLY = probeReportMode().checkOnly;
const TICKS_PER_SECOND = 120_000;
const CASES = Object.freeze([
	{ group: "layout", id: "perspective" },
	{ group: "enter", id: "assemble" },
	{ group: "fx", id: "mosaic" },
	{ group: "bg", id: "noiseField" },
	{ group: "trans", id: "hrBlink" },
]);
const CONFIG = Object.freeze({
	width: 320,
	height: 180,
	fps: Object.freeze({ numerator: 30, denominator: 1 }),
	duration: 6 * TICKS_PER_SECOND,
	seed: 20_260_928,
	previewText: "ROCUT MATRIX\nJIZURA PRESET",
	samplePositions: Object.freeze([0.2, 0.5, 0.8]),
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

function authoritativeEntries() {
	const catalog = strictJson(CATALOG_PATH);
	const entries = CASES.map((selected) => {
		const matches = catalog.entries.filter(
			(entry) => entry.group === selected.group && entry.id === selected.id,
		);
		if (matches.length !== 1) {
			throw new Error(
				`Catalog must contain exactly one ${selected.group}:${selected.id} entry`,
			);
		}
		const entry = matches[0];
		return {
			group: entry.group,
			id: entry.id,
			name: entry.name,
			pack: entry.pack,
			sourceFile: entry.sourceFile,
		};
	});
	return { catalog, entries };
}

function sameJson(left, right) {
	return JSON.stringify(left) === JSON.stringify(right);
}

function validateReport(report) {
	const { catalog, entries } = authoritativeEntries();
	if (report.schemaVersion !== 1) {
		throw new Error("Motion-text export matrix schemaVersion must be 1");
	}
	if (!sameJson(report.config, CONFIG)) {
		throw new Error(
			"Motion-text export matrix uses an unexpected configuration",
		);
	}
	const wasmIdentity = fileIdentity(WASM_PATH);
	const catalogIdentity = fileIdentity(CATALOG_PATH);
	if (!sameJson(report.source?.canonicalWasm, wasmIdentity)) {
		throw new Error("Motion-text export matrix uses a stale canonical WASM");
	}
	if (
		!sameJson(report.source?.canonicalCatalog?.identity, catalogIdentity) ||
		report.source.canonicalCatalog.schemaVersion !== catalog.schemaVersion ||
		report.source.canonicalCatalog.totalEntries !== catalog.counts.total
	) {
		throw new Error("Motion-text export matrix uses a stale preset catalog");
	}
	if (
		!Array.isArray(report.results) ||
		report.results.length !== entries.length
	) {
		throw new Error("Motion-text export matrix must cover all selected cases");
	}

	const frameDigests = new Set();
	const exportDigests = new Set();
	for (const entry of entries) {
		const result = report.results.find(
			(candidate) =>
				candidate.group === entry.group && candidate.id === entry.id,
		);
		if (!result) {
			throw new Error(`Missing export result for ${entry.group}:${entry.id}`);
		}
		if (
			!sameJson(result.catalog, {
				name: entry.name,
				pack: entry.pack,
				sourceFile: entry.sourceFile,
			})
		) {
			throw new Error(`Stale catalog metadata for ${entry.group}:${entry.id}`);
		}
		if (
			!Array.isArray(result.factory?.diagnostics) ||
			result.factory.diagnostics.length !== 0 ||
			result.factory.cueCount < 2 ||
			result.factory.cutCount < 2 ||
			result.factory.eligibleCutCount !==
				(entry.group === "trans"
					? result.factory.cutCount - 1
					: result.factory.cutCount) ||
			result.factory.appliedCutCount !== result.factory.eligibleCutCount
		) {
			throw new Error(
				`Canonical factory evidence is invalid for ${entry.group}:${entry.id}: ${JSON.stringify(result.factory)}`,
			);
		}
		if (
			!Number.isInteger(result.window?.startTime) ||
			result.window.startTime < 0 ||
			!Number.isInteger(result.window.duration) ||
			result.window.duration <= 0 ||
			result.window.startTime + result.window.duration > CONFIG.duration
		) {
			throw new Error(`Invalid preview window for ${entry.group}:${entry.id}`);
		}
		if (
			!Array.isArray(result.frames?.samples) ||
			result.frames.samples.length !== CONFIG.samplePositions.length ||
			!result.frames.samples.some((sample) => sample.nonBlackPixels > 0) ||
			!/^[0-9a-f]{64}$/.test(result.frames.combinedSha256)
		) {
			throw new Error(
				`No visible frame evidence for ${entry.group}:${entry.id}`,
			);
		}
		const ticksPerFrame = Math.round(
			(TICKS_PER_SECOND * CONFIG.fps.denominator) / CONFIG.fps.numerator,
		);
		const expectedFrames = Math.floor(result.window.duration / ticksPerFrame);
		if (
			result.export?.frames !== expectedFrames ||
			expectedFrames <= 0 ||
			result.export.progressEvents < expectedFrames ||
			result.export.completeEvents !== 1 ||
			result.export.errorEvents !== 0 ||
			!Number.isFinite(result.export.elapsedMs) ||
			result.export.elapsedMs < 0 ||
			result.export.bufferBytes <= 8 ||
			result.export.fileType !== "ftyp" ||
			!/^[0-9a-f]{64}$/.test(result.export.sha256)
		) {
			throw new Error(`Invalid MP4 export for ${entry.group}:${entry.id}`);
		}
		frameDigests.add(result.frames.combinedSha256);
		exportDigests.add(result.export.sha256);
	}
	if (frameDigests.size !== entries.length) {
		throw new Error(
			"Representative presets did not produce distinct frame summaries",
		);
	}
	if (exportDigests.size !== entries.length) {
		throw new Error(
			"Representative presets did not produce distinct MP4 outputs",
		);
	}
	if (
		report.fontRuntime?.cachedFonts < 1 ||
		report.fontRuntime.loadedFaces < 1 ||
		report.fontRuntime.pendingLoads !== 0 ||
		report.fontRuntime.disposed !== false
	) {
		throw new Error(
			"Motion-text export matrix lacks valid offline-font evidence",
		);
	}
}

if (CHECK_ONLY) {
	const report = strictJson(REPORT_PATH);
	validateReport(report);
	console.log(
		`motion-text export matrix: PASS (${report.results.map((entry) => `${entry.group}:${entry.id}`).join(", ")})`,
	);
	process.exit(0);
}

const { catalog, entries } = authoritativeEntries();
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
		`http://127.0.0.1:${address.port}/script/fixtures/motion-text-export-matrix-probe.html`,
	);
	await page.waitForFunction(
		() => typeof globalThis.__probeMotionTextExportMatrix === "function",
	);
	const result = await page.evaluate(
		async ({ selectedEntries, config }) =>
			globalThis.__probeMotionTextExportMatrix({
				entries: selectedEntries,
				config,
			}),
		{ selectedEntries: entries, config: CONFIG },
	);
	if (pageErrors.length > 0) throw new Error(pageErrors.join("\n"));
	const report = {
		schemaVersion: 1,
		generatedBy: "script/probe-motion-text-export-matrix.mjs",
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
			userAgent: result.userAgent,
		},
		config: CONFIG,
		fontRuntime: result.fontRuntime,
		results: result.results,
	};
	validateReport(report);
	emitProbeReport({ report, reportPath: REPORT_PATH });
} finally {
	await browser?.close();
	await server.close();
}

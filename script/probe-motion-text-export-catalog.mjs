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
const REPORT_PATH = join(ROOT, "docs/motion-text/s09-export-catalog.json");
const CATALOG_PATH = join(ROOT, "docs/motion-text/jizura-preset-catalog.json");
const WASM_PATH = join(ROOT, "rust/wasm/pkg/opencut_wasm_bg.wasm");
const CHECK_ONLY = probeReportMode().checkOnly;
const TICKS_PER_SECOND = 120_000;
const GROUPS = Object.freeze([
	"style",
	"layout",
	"enter",
	"hold",
	"exit",
	"decor",
	"treat",
	"bg",
	"cam",
	"fx",
	"trans",
]);
const CONFIG = Object.freeze({
	width: 320,
	height: 180,
	fps: Object.freeze({ numerator: 30, denominator: 1 }),
	duration: 6 * TICKS_PER_SECOND,
	seed: 20_260_928,
	previewText: "ROCUT CATALOG\nEXPORT SMOKE",
	samplePositions: Object.freeze([0.15, 0.5, 0.85]),
	exportFrameLimit: 2,
	logProgress: true,
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

function sha256Text(value) {
	return createHash("sha256").update(value).digest("hex");
}

function round(value) {
	return Math.round(value * 10_000) / 10_000;
}

function authoritativeEntries() {
	const catalog = strictJson(CATALOG_PATH);
	const entries = catalog.entries
		.filter((entry) => GROUPS.includes(entry.group))
		.map((entry) => ({
			group: entry.group,
			id: entry.id,
			name: entry.name,
			pack: entry.pack,
			sourceFile: entry.sourceFile,
		}));
	const keys = entries.map((entry) => `${entry.group}:${entry.id}`);
	if (
		entries.length !== 889 ||
		new Set(keys).size !== entries.length ||
		GROUPS.some(
			(group) =>
				entries.filter((entry) => entry.group === group).length !==
				catalog.counts[group],
		)
	) {
		throw new Error(
			"Authoritative drawable catalog is not the expected 889 entries",
		);
	}
	return { catalog, entries, keys };
}

function sameJson(left, right) {
	return JSON.stringify(left) === JSON.stringify(right);
}

function validateRawResults({ entries, results }) {
	if (!Array.isArray(results) || results.length !== entries.length) {
		throw new Error(
			`Full export catalog returned ${results?.length ?? "no"}/${entries.length} results`,
		);
	}
	const expectedKeys = new Set(
		entries.map((entry) => `${entry.group}:${entry.id}`),
	);
	const actualKeys = new Set(
		results.map((entry) => `${entry.group}:${entry.id}`),
	);
	if (
		actualKeys.size !== expectedKeys.size ||
		[...expectedKeys].some((key) => !actualKeys.has(key))
	) {
		throw new Error("Full export catalog result keys do not match the catalog");
	}
	for (const result of results) {
		const key = `${result.group}:${result.id}`;
		if (
			!Array.isArray(result.factory?.diagnostics) ||
			result.factory.diagnostics.length !== 0 ||
			result.factory.cueCount < 2 ||
			result.factory.cutCount < 2 ||
			result.factory.appliedCutCount !== result.factory.eligibleCutCount
		) {
			throw new Error(`Invalid canonical factory evidence for ${key}`);
		}
		if (
			!Array.isArray(result.frames?.samples) ||
			result.frames.samples.length !== CONFIG.samplePositions.length ||
			!result.frames.samples.some((sample) => sample.nonBlackPixels > 0) ||
			!/^[0-9a-f]{64}$/.test(result.frames.combinedSha256)
		) {
			throw new Error(`No visible compositor evidence for ${key}`);
		}
		if (
			result.window?.duration !==
				(CONFIG.exportFrameLimit * TICKS_PER_SECOND) / CONFIG.fps.numerator ||
			result.export?.frames !== CONFIG.exportFrameLimit ||
			result.export.progressEvents < CONFIG.exportFrameLimit ||
			result.export.completeEvents !== 1 ||
			result.export.errorEvents !== 0 ||
			!Number.isFinite(result.export.elapsedMs) ||
			result.export.bufferBytes <= 8 ||
			result.export.fileType !== "ftyp" ||
			!/^[0-9a-f]{64}$/.test(result.export.sha256)
		) {
			throw new Error(`Invalid SceneExporter MP4 evidence for ${key}`);
		}
	}
}

function summarizeGroup({ group, results }) {
	const selected = results.filter((entry) => entry.group === group);
	const evidence = selected.map(
		(entry) =>
			`${entry.group}:${entry.id}:${entry.frames.combinedSha256}:${entry.export.sha256}:${entry.export.bufferBytes}`,
	);
	return {
		group,
		entries: selected.length,
		eligibleCuts: selected.reduce(
			(sum, entry) => sum + entry.factory.eligibleCutCount,
			0,
		),
		appliedCuts: selected.reduce(
			(sum, entry) => sum + entry.factory.appliedCutCount,
			0,
		),
		visibleEntries: selected.filter((entry) =>
			entry.frames.samples.some((sample) => sample.nonBlackPixels > 0),
		).length,
		encodedFrames: selected.reduce(
			(sum, entry) => sum + entry.export.frames,
			0,
		),
		validMp4: selected.filter((entry) => entry.export.fileType === "ftyp")
			.length,
		completeEvents: selected.reduce(
			(sum, entry) => sum + entry.export.completeEvents,
			0,
		),
		errorEvents: selected.reduce(
			(sum, entry) => sum + entry.export.errorEvents,
			0,
		),
		bufferBytes: selected.reduce(
			(sum, entry) => sum + entry.export.bufferBytes,
			0,
		),
		exportElapsedMs: round(
			selected.reduce((sum, entry) => sum + entry.export.elapsedMs, 0),
		),
		maxExportElapsedMs: round(
			Math.max(...selected.map((entry) => entry.export.elapsedMs)),
		),
		distinctFrameDigests: new Set(
			selected.map((entry) => entry.frames.combinedSha256),
		).size,
		distinctMp4Digests: new Set(selected.map((entry) => entry.export.sha256))
			.size,
		evidenceSha256: sha256Text(evidence.join("\n")),
	};
}

function buildReport({ catalog, entries, result, browserVersion }) {
	validateRawResults({ entries, results: result.results });
	const keys = entries.map((entry) => `${entry.group}:${entry.id}`);
	const resultKeys = result.results.map(
		(entry) => `${entry.group}:${entry.id}`,
	);
	const groups = GROUPS.map((group) =>
		summarizeGroup({ group, results: result.results }),
	);
	return {
		schemaVersion: 1,
		generatedBy: "script/probe-motion-text-export-catalog.mjs",
		source: {
			canonicalWasm: fileIdentity(WASM_PATH),
			canonicalCatalog: {
				identity: fileIdentity(CATALOG_PATH),
				schemaVersion: catalog.schemaVersion,
				totalEntries: catalog.counts.total,
				drawableEntries: entries.length,
				keysSha256: sha256Text(keys.join("\n")),
			},
		},
		environment: {
			browser: browserVersion,
			userAgent: result.userAgent,
		},
		config: CONFIG,
		fontRuntime: result.fontRuntime,
		coverage: {
			resultKeysSha256: sha256Text(resultKeys.join("\n")),
			entries: result.results.length,
			visibleEntries: groups.reduce(
				(sum, group) => sum + group.visibleEntries,
				0,
			),
			eligibleCuts: groups.reduce((sum, group) => sum + group.eligibleCuts, 0),
			appliedCuts: groups.reduce((sum, group) => sum + group.appliedCuts, 0),
			encodedFrames: groups.reduce(
				(sum, group) => sum + group.encodedFrames,
				0,
			),
			validMp4: groups.reduce((sum, group) => sum + group.validMp4, 0),
			completeEvents: groups.reduce(
				(sum, group) => sum + group.completeEvents,
				0,
			),
			errorEvents: groups.reduce((sum, group) => sum + group.errorEvents, 0),
			bufferBytes: groups.reduce((sum, group) => sum + group.bufferBytes, 0),
			exportElapsedMs: round(
				groups.reduce((sum, group) => sum + group.exportElapsedMs, 0),
			),
		},
		groups,
	};
}

function validateReport(report) {
	const { catalog, entries, keys } = authoritativeEntries();
	if (report.schemaVersion !== 1 || !sameJson(report.config, CONFIG)) {
		throw new Error(
			"Full export catalog report schema or configuration is stale",
		);
	}
	if (!sameJson(report.source?.canonicalWasm, fileIdentity(WASM_PATH))) {
		throw new Error("Full export catalog report uses a stale canonical WASM");
	}
	const catalogSource = report.source?.canonicalCatalog;
	if (
		!sameJson(catalogSource?.identity, fileIdentity(CATALOG_PATH)) ||
		catalogSource.schemaVersion !== catalog.schemaVersion ||
		catalogSource.totalEntries !== catalog.counts.total ||
		catalogSource.drawableEntries !== entries.length ||
		catalogSource.keysSha256 !== sha256Text(keys.join("\n"))
	) {
		throw new Error("Full export catalog report uses a stale preset catalog");
	}
	if (
		report.coverage?.resultKeysSha256 !== catalogSource.keysSha256 ||
		report.coverage.entries !== entries.length ||
		report.coverage.visibleEntries !== entries.length ||
		report.coverage.eligibleCuts !== report.coverage.appliedCuts ||
		report.coverage.encodedFrames !==
			entries.length * CONFIG.exportFrameLimit ||
		report.coverage.validMp4 !== entries.length ||
		report.coverage.completeEvents !== entries.length ||
		report.coverage.errorEvents !== 0 ||
		report.coverage.bufferBytes <= 0 ||
		!Number.isFinite(report.coverage.exportElapsedMs)
	) {
		throw new Error("Full export catalog aggregate evidence is incomplete");
	}
	if (!Array.isArray(report.groups) || report.groups.length !== GROUPS.length) {
		throw new Error("Full export catalog lacks per-group evidence");
	}
	for (const group of GROUPS) {
		const summary = report.groups.find((entry) => entry.group === group);
		const expected = catalog.counts[group];
		if (
			summary?.entries !== expected ||
			summary.visibleEntries !== expected ||
			summary.eligibleCuts !== summary.appliedCuts ||
			summary.encodedFrames !== expected * CONFIG.exportFrameLimit ||
			summary.validMp4 !== expected ||
			summary.completeEvents !== expected ||
			summary.errorEvents !== 0 ||
			summary.bufferBytes <= 0 ||
			!Number.isFinite(summary.exportElapsedMs) ||
			!Number.isFinite(summary.maxExportElapsedMs) ||
			summary.distinctFrameDigests <= 0 ||
			summary.distinctMp4Digests <= 0 ||
			!/^[0-9a-f]{64}$/.test(summary.evidenceSha256)
		) {
			throw new Error(`Full export catalog ${group} evidence is invalid`);
		}
	}
	if (
		report.fontRuntime?.cachedFonts < 1 ||
		report.fontRuntime.loadedFaces < 1 ||
		report.fontRuntime.pendingLoads !== 0 ||
		report.fontRuntime.disposed !== false
	) {
		throw new Error("Full export catalog lacks valid offline-font evidence");
	}
}

if (CHECK_ONLY) {
	const report = strictJson(REPORT_PATH);
	validateReport(report);
	console.log(
		`motion-text export catalog: PASS (${report.coverage.entries} entries, ${report.coverage.encodedFrames} frames, ${report.coverage.validMp4} MP4s)`,
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
	const report = buildReport({
		catalog,
		entries,
		result,
		browserVersion: await browser.version(),
	});
	validateReport(report);
	emitProbeReport({ report, reportPath: REPORT_PATH });
} finally {
	await browser?.close();
	await server.close();
}

#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";
import { createServer } from "vite";
import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const COMPATIBILITY_PATH = join(
	ROOT,
	"docs/motion-text/jizura-preset-compatibility.json",
);
const OUTPUT_PATH = join(ROOT, "docs/motion-text/jizura-renderer-costs.json");
const CHECK_ONLY = process.argv.includes("--check");
const CONFIG = {
	width: 1280,
	height: 720,
	warmupFrames: 5,
	sampleFrames: 30,
	measurement: "resolve-draw-and-canvas-flush",
	thresholds: {
		lowMaxMs: 4.17,
		mediumMaxMs: 8.33,
		highMaxMs: 16.67,
		heavyMaxMs: 33.33,
	},
};

function strictJson(path) {
	const source = new TextDecoder("utf-8", { fatal: true }).decode(
		readFileSync(path),
	);
	return JSON.parse(source);
}

function supportedEntries(compatibility) {
	return compatibility.entries
		.filter((entry) => entry.status === "supported" && entry.group !== "font")
		.map(({ group, id }) => ({ group, id }))
		.sort((left, right) =>
			`${left.group}:${left.id}`.localeCompare(`${right.group}:${right.id}`),
		);
}

function validateReport({ compatibility, entries, report }) {
	if (report.schemaVersion !== 1) {
		throw new Error("Motion-text cost report schemaVersion must be 1");
	}
	if (
		report.source?.rendererSupportVersion !==
		compatibility.source.rendererSupportVersion
	) {
		throw new Error("Motion-text cost report uses stale renderer support");
	}
	if (
		report.config?.width !== CONFIG.width ||
		report.config?.height !== CONFIG.height ||
		report.config?.sampleFrames < CONFIG.sampleFrames
	) {
		throw new Error("Motion-text cost report does not satisfy the 720p budget");
	}
	const expectedKeys = entries.map(({ group, id }) => `${group}:${id}`).sort();
	const measuredKeys = report.measurements
		.map((measurement) => measurement.key)
		.sort();
	if (
		measuredKeys.length !== expectedKeys.length ||
		expectedKeys.some((key, index) => key !== measuredKeys[index])
	) {
		throw new Error("Motion-text cost report does not cover current support");
	}
	for (const measurement of report.measurements) {
		if (
			!Number.isFinite(measurement.p95Ms) ||
			measurement.p95Ms < 0 ||
			!["low", "medium", "high", "heavy", "over-budget"].includes(
				measurement.tier,
			)
		) {
			throw new Error(`Invalid cost measurement for ${measurement.key}`);
		}
	}
}

const compatibility = strictJson(COMPATIBILITY_PATH);
const entries = supportedEntries(compatibility);
if (CHECK_ONLY) {
	const report = strictJson(OUTPUT_PATH);
	validateReport({ compatibility, entries, report });
	console.log(
		`motion-text renderer costs: PASS (${report.measurements.length} supported presets)`,
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
		`http://127.0.0.1:${address.port}/script/fixtures/motion-text-renderer-cost-benchmark.html`,
	);
	await page.waitForFunction(
		() => typeof globalThis.__benchmarkMotionTextPresets === "function",
	);
	const result = await page.evaluate(
		async ({ entries: benchmarkEntries, config }) =>
			globalThis.__benchmarkMotionTextPresets({
				entries: benchmarkEntries,
				config,
			}),
		{ entries, config: CONFIG },
	);
	if (pageErrors.length > 0) throw new Error(pageErrors.join("\n"));
	const tierCounts = Object.fromEntries(
		["low", "medium", "high", "heavy", "over-budget"].map((tier) => [
			tier,
			result.measurements.filter((measurement) => measurement.tier === tier)
				.length,
		]),
	);
	const slowest = [...result.measurements]
		.sort((left, right) => right.p95Ms - left.p95Ms)
		.slice(0, 10)
		.map(({ key, p95Ms, tier }) => ({ key, p95Ms, tier }));
	const report = {
		schemaVersion: 1,
		generatedBy: "script/benchmark-motion-text-renderer.mjs",
		source: {
			rendererSupportVersion: compatibility.source.rendererSupportVersion,
		},
		environment: {
			browser: await browser.version(),
			userAgent: result.userAgent,
			canvas: "2d-will-read-frequently",
		},
		config: CONFIG,
		summary: {
			measured: result.measurements.length,
			tiers: tierCounts,
			slowest,
		},
		measurements: result.measurements,
	};
	validateReport({ compatibility, entries, report });
	writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, "\t")}\n`, "utf8");
	console.log(
		`motion-text renderer costs: ${report.summary.measured} presets -> ${OUTPUT_PATH}`,
	);
	console.log(`tiers=${JSON.stringify(tierCounts)}`);
	console.log(
		`slowest=${slowest.map(({ key, p95Ms }) => `${key}:${p95Ms.toFixed(2)}ms`).join(",")}`,
	);
} finally {
	await browser?.close();
	await server.close();
}

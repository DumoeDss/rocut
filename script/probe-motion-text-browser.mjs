#!/usr/bin/env node

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";
import { createServer } from "vite";
import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";

import {
	MOTION_TEXT_PLAN_VERSION,
	MOTION_TEXT_SCHEMA_VERSION,
	mapMotionTextClipTime,
	parseMotionTextSource,
	planMotionTextSequence,
	tokenizeMotionText,
} from "../rust/wasm/pkg/opencut_wasm_sync.js";
import {
	invalidMotionTextPlannerFixture,
	motionTextPlannerFixture,
	motionTextSemanticSummary,
} from "./fixtures/motion-text-planner-fixture.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = [
	{
		sequenceId: "browser-valid",
		source: "[ti:Bridge]\n[00:01.25]*hello*/world! | note",
	},
	{
		sequenceId: "browser-invalid",
		source: "[999999999999999999999999:00]overflow",
	},
];

const expected = {
	planVersion: MOTION_TEXT_PLAN_VERSION,
	schemaVersion: MOTION_TEXT_SCHEMA_VERSION,
	results: FIXTURES.map((fixture) => parseMotionTextSource(fixture)),
	planner: planMotionTextSequence(motionTextPlannerFixture()),
	invalidPlanner: planMotionTextSequence(invalidMotionTextPlannerFixture()),
	tokenizer: tokenizeMotionText({
		text: "你好世界再次相见",
		language: "zh-Hans",
	}),
	clipTime: mapMotionTextClipTime({
		clipStartTime: 120_000,
		clipDuration: 240_000,
		trimStart: 60_000,
		timelineTime: 180_000,
		sequenceDuration: 360_000,
	}),
	semanticSummary: motionTextSemanticSummary({
		parseMotionTextSource,
		planMotionTextSequence,
		tokenizeMotionText,
	}),
};
const server = await createServer({
	root: ROOT,
	logLevel: "error",
	plugins: [wasm(), topLevelAwait()],
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
	const page = await browser.newPage();
	const pageErrors = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	await page.goto(
		`http://127.0.0.1:${address.port}/script/fixtures/motion-text-browser-probe.html`,
	);
	await page.waitForFunction(() => "__motionTextBrowserProbe" in globalThis);
	const actual = await page.evaluate(() => globalThis.__motionTextBrowserProbe);
	if (pageErrors.length > 0) throw new Error(pageErrors.join("\n"));
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(
			`Node/browser motion-text bridge mismatch\nnode=${JSON.stringify(expected)}\nbrowser=${JSON.stringify(actual)}`,
		);
	}
	if (
		!actual.results[1].diagnostics.some(
			(diagnostic) =>
				diagnostic.severity === "error" &&
				diagnostic.code === "invalid-lrc-time",
		)
	) {
		throw new Error("Invalid fixture did not produce the structured error");
	}
	if (!actual.planner.plan || actual.planner.plan.cuts.length !== 3) {
		throw new Error("Planner fixture did not produce the expected stable cuts");
	}
	if (
		actual.invalidPlanner.plan !== null ||
		!actual.invalidPlanner.diagnostics.some(
			(diagnostic) => diagnostic.code === "overlapping-cues",
		)
	) {
		throw new Error("Invalid planner fixture did not fail atomically");
	}
	if (
		actual.tokenizer.version !== "unicode-v1" ||
		actual.tokenizer.segments.join("|") !== "你好世界|再次相见" ||
		actual.clipTime.sequenceTime !== 120_000
	) {
		throw new Error("Tokenizer or clip-time mapping changed across the bridge");
	}
	console.log(
		`probe-motion-text-browser: parse, plan, tokenize and clip-time results match across Node/Chromium`,
	);
} finally {
	await browser?.close();
	await server.close();
}

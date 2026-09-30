#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = resolve(process.argv[2] ?? join(ROOT, "..", "JIZURA"));
const fixture = JSON.parse(
	readFileSync(
		join(
			ROOT,
			"rust",
			"crates",
			"motion-text",
			"fixtures",
			"jizura-v1-project.json",
		),
		"utf8",
	),
);
const expected = JSON.parse(
	readFileSync(
		join(
			ROOT,
			"rust",
			"crates",
			"motion-text",
			"fixtures",
			"jizura-v1-expected.json",
		),
		"utf8",
	),
);

const browser = await chromium.launch({ headless: true });
try {
	const page = await browser.newPage();
	await page.goto(pathToFileURL(join(SOURCE, "index.html")).href, {
		waitUntil: "load",
	});
	await page.waitForFunction(() =>
		Boolean(window.J?.defaultProject && window.J?.plan),
	);
	const actual = await page.evaluate((input) => {
		const defaults = window.J.defaultProject();
		const project = {
			...defaults,
			...input,
			fx: { ...defaults.fx, ...(input.fx ?? {}) },
			timing: { ...defaults.timing, ...(input.timing ?? {}) },
		};
		const plan = window.J.plan(project, null);
		const preset = (cut) => ({
			layout: cut.layout,
			enter: cut.enter,
			hold: cut.hold,
			exit: cut.exit,
		});
		return {
			language: plan.lang,
			title: plan.title,
			artist: plan.artist,
			duration: Math.round(plan.duration * 120_000),
			cueStarts: plan.lines.map((line) => Math.round(line.start * 120_000)),
			cueDurations: plan.lines.map((line) =>
				Math.round((line.end - line.start) * 120_000),
			),
			line0Preset: preset(plan.cuts.find((cut) => cut.line === 0)),
			line1FirstCutPreset: preset(plan.cuts.find((cut) => cut.line === 1)),
		};
	}, fixture);

	for (const key of [
		"language",
		"title",
		"artist",
		"duration",
		"cueStarts",
		"cueDurations",
		"line0Preset",
		"line1FirstCutPreset",
	]) {
		assert.deepEqual(
			actual[key],
			expected[key],
			`JIZURA fixture mismatch at ${key}`,
		);
	}
	console.log(
		JSON.stringify(
			{
				status: "PASS",
				source: SOURCE,
				fixture: "jizura-v1-project.json",
				actual,
			},
			null,
			2,
		),
	);
} finally {
	await browser.close();
}

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
	DEGRADED_BANNER_TEXT,
	PLAYHEAD_LABEL,
	RULER_LABEL,
	waitForDegradedBanner,
} from "./smoke-banner.mjs";

test("the smoke's exact banner text matches the authored degraded UI", async () => {
	const source = await readFile(
		new URL("../../packages/editor-classic/src/editor/surface/editor-root.tsx", import.meta.url),
		"utf8",
	);
	const banner = source.slice(source.indexOf("function DegradedRendererBanner()"), source.indexOf("function EditorLayout()"));
	assert.ok(banner.includes(DEGRADED_BANNER_TEXT));
	assert.ok(banner.includes('if (!isDegraded || dismissed) return null;'));
});

test("timeline interaction labels match the authored accessible controls", async () => {
	for (const [filename, label] of [
		["timeline-playhead.tsx", PLAYHEAD_LABEL],
		["timeline-ruler.tsx", RULER_LABEL],
	]) {
		const source = await readFile(
			new URL(`../../packages/editor-classic/src/timeline/components/${filename}`, import.meta.url),
			"utf8",
		);
		assert.ok(source.includes(`aria-label="${label}"`));
		assert.ok(source.includes('role="slider"'));
	}
});

test("a missing banner preserves the original failure and bounds diagnostics", async () => {
	const failure = new Error("banner did not become visible");
	const messages = [];
	const originalError = console.error;
	console.error = (...args) => messages.push(args);
	try {
		await assert.rejects(waitForDegradedBanner({
			getByText(text, options) {
				assert.equal(text, DEGRADED_BANNER_TEXT);
				assert.deepEqual(options, { exact: true });
				return {
					async waitFor(options) {
						assert.deepEqual(options, { state: "visible", timeout: 120_000 });
						throw failure;
					},
					async count() { return 0; },
					async isVisible() { throw new Error("page closed"); },
				};
			},
		}, {
			consoleErrors: Array.from({ length: 8 }, (_, i) => `console ${i}`),
			pageErrors: ["page error"],
			failedResponses: ["404 http://127.0.0.1/missing"],
		}), (error) => error === failure);
		const diagnostic = JSON.parse(messages[0][1]);
		assert.equal(diagnostic.consoleErrors.length, 5);
		assert.deepEqual(diagnostic.pageErrors, ["page error"]);
		assert.equal(diagnostic.candidates[0].value, 0);
		assert.equal(diagnostic.candidates[1].status, "rejected");
	} finally {
		console.error = originalError;
	}
});

import { expect, test } from "bun:test";
import { clipAudio, clipDifference } from "./mv-ember-clip-input";
import { clipReplaySource, type ClipVariant } from "./mv-ember-clip-replay";
import { MV_RECIPE_RENDERER_SOURCE } from "../../packages/editor-classic/src/services/renderer/programmatic/mv-recipe-renderer";
import { CLIP_CONTEXT_CASES, clipContextSource } from "./mv-ember-clip-context";

test("diagnostic reconstructs complete deterministic fixture audio without WASM", () => {
	// Do not assert Chrome's sin()/JSON byte hash in Bun's different JS engine.
	// verifyClipInput checks the saved hash in the actual diagnostic browser.
	const audio = clipAudio();
	expect(audio).toEqual(clipAudio());
	expect(audio.beats).toHaveLength(65);
	expect(audio.strongOnsets).toHaveLength(5);
	for (const values of [
		audio.envelopes.rms,
		audio.envelopes.low,
		audio.envelopes.mid,
		audio.envelopes.high,
	])
		expect(values).toHaveLength(901);
});

test("baseline stays byte-identical and every independent in-memory toggle parses", () => {
	expect(clipReplaySource("baseline")).toBe(MV_RECIPE_RENDERER_SOURCE);
	expect(clipReplaySource("decode-none")).toBe(MV_RECIPE_RENDERER_SOURCE);
	for (const variant of [
		"baseline",
		"cover-save",
		"clip-default",
		"keep-clip-ctm",
		"all-state",
		"decode-none",
		"image-mask",
		"image-and-rect-mask",
		"html-coverage-mask",
		"image-mask-source-in",
		"image-pattern",
	] satisfies ClipVariant[]) {
		const source = clipReplaySource(variant);
		expect(() => new Function(source)).not.toThrow();
		if (variant !== "baseline" && variant !== "decode-none")
			expect(source).not.toBe(MV_RECIPE_RENDERER_SOURCE);
	}
});

test("diagnostic reports both changed pixels and changed channels", () => {
	expect(
		clipDifference(
			new Uint8ClampedArray([10, 20, 30, 255, 1, 2, 3, 255]),
			new Uint8ClampedArray([8, 20, 35, 255, 1, 2, 3, 255]),
		),
	).toEqual({ max: 5, mae: 7 / 8, changedPixels: 1, changedChannels: 2 });
});

test("context controls keep replay in Worker and exercise layered placeholders independently", () => {
	expect(() => new Function(clipContextSource())).not.toThrow();
	expect(clipContextSource()).toContain("clipDiagnosticSurface('layer',w,h)");
	expect(clipContextSource()).toContain(
		"clipDiagnosticSurface('output',1920,1080)",
	);
	expect(
		CLIP_CONTEXT_CASES.find((test) => test.label === "transfer-layer-only")
			?.transferred,
	).toEqual(["layer"]);
	expect(
		CLIP_CONTEXT_CASES.find(
			(test) => test.label === "transfer-output-only-layered",
		)?.transferred,
	).toEqual(["output"]);
	expect(
		CLIP_CONTEXT_CASES.find((test) => test.label === "transfer-output-direct")
			?.layered,
	).toBe(false);
	expect(new Set(CLIP_CONTEXT_CASES.map((test) => test.label)).size).toBe(
		CLIP_CONTEXT_CASES.length,
	);
});

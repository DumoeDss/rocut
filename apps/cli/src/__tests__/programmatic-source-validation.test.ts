import { expect, test } from "bun:test";
import { validateProgrammaticSource } from "../programmatic/validate-source";

const source = {
	version: 1,
	runtime: "canvas-worker",
	code: "canvas.fillRect(0,0,1,1)",
	width: 16,
	height: 16,
	frameRate: { numerator: 30, denominator: 1 },
	durationFrames: 30,
	seed: 1,
	resources: [],
};
test("actual Rust validator returns a byte-bound closure without running authored code", () => {
	const receipt = validateProgrammaticSource(source);
	expect(receipt.producerFingerprint).toMatch(/^[a-f0-9]{64}$/);
	expect(receipt.requiredCapabilities).toEqual(["programmatic:canvas-worker"]);
	expect(receipt.resourceIds).toEqual([]);
});
test("actual Rust rejects invalid source duration and unknown recipe schema", () => {
	expect(() =>
		validateProgrammaticSource({ ...source, durationFrames: 1000001 }),
	).toThrow("duration");
	expect(() =>
		validateProgrammaticSource({
			...source,
			code: "",
			recipe: { kind: "invented" },
		}),
	).toThrow();
});
test("validation requests defer recipe execution and propagate native errors", () => {
	let request: Record<string, unknown> = {};
	const receipt = validateProgrammaticSource(source, {
		resolve: (input) => {
			request = JSON.parse(input);
			return JSON.stringify({ frame: { index: 0 } });
		},
		fingerprint: () => "a".repeat(64),
	});
	expect(request).toMatchObject({
		deferRecipe: true,
		clipDuration: 120000,
		timelineTime: 0,
	});
	expect(receipt.producerFingerprint).toBe("a".repeat(64));
	expect(() =>
		validateProgrammaticSource(source, {
			resolve: () => JSON.stringify({ error: "invalid closure" }),
			fingerprint: () => "a".repeat(64),
		}),
	).toThrow("invalid closure");
});
test("HTML and unbounded executable sources never enter the source validator", () => {
	expect(() =>
		validateProgrammaticSource({ ...source, runtime: "html-document" }),
	).toThrow("Canvas");
	expect(() =>
		validateProgrammaticSource({
			...source,
			code: "x".repeat(4 * 1024 ** 2 + 1),
		}),
	).toThrow();
});

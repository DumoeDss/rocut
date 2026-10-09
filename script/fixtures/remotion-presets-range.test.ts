import { expect, test } from "bun:test";
import type { ProgrammaticSource } from "@opencut/editor-contracts";
import {
	presetExportWindow,
	presetFrameTicks,
	presetRangeMode,
} from "./remotion-presets-range";

const source = (durationFrames: number, numerator = 30, denominator = 1) =>
	({
		durationFrames,
		frameRate: { numerator, denominator },
	}) as ProgrammaticSource;

test("preset windows keep smoke coverage and include every frame in full mode", () => {
	expect(presetExportWindow(source(90), "smoke")).toEqual({
		firstFrame: 45,
		frameCount: 3,
		trimStart: 180000,
		trimEnd: 168000,
		duration: 12000,
	});
	expect(presetExportWindow(source(90), "full")).toEqual({
		firstFrame: 0,
		frameCount: 90,
		trimStart: 0,
		trimEnd: 0,
		duration: 360000,
	});
	expect(presetExportWindow(source(2), "smoke")).toEqual({
		firstFrame: 0,
		frameCount: 2,
		trimStart: 0,
		trimEnd: 0,
		duration: 8000,
	});
	expect(presetExportWindow(source(120, 30000, 1001), "full").duration).toBe(
		480480,
	);
	expect(presetFrameTicks(source(120, 24), 5)).toBe(25000);
});

test("invalid configuration fails before launching a browser", () => {
	expect(presetRangeMode()).toBe("smoke");
	expect(presetRangeMode("smoke")).toBe("smoke");
	expect(presetRangeMode("full")).toBe("full");
	for (const value of ["", "partial", "Full"])
		expect(() => presetRangeMode(value)).toThrow("smoke or full");
	for (const duration of [0, -1, 1.5, NaN, Infinity])
		expect(() => presetExportWindow(source(duration), "full")).toThrow(
			"duration",
		);
	expect(() => presetFrameTicks(source(2), -1)).toThrow("nonnegative integer");
	expect(() => presetFrameTicks(source(2, 0), 1)).toThrow("frame rate");
});

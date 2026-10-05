import { expect, test } from "bun:test";
import { frameRateSelectOption } from "../presets";

test("fractional project rates retain their exact standard labels", () => {
	for (const [numerator, value] of [
		[24000, "23.976"],
		[30000, "29.97"],
		[60000, "59.94"],
	] as const) {
		expect(frameRateSelectOption({ numerator, denominator: 1001 })).toEqual({
			value,
			label: `${value} fps`,
		});
	}
	expect(frameRateSelectOption({ numerator: 30, denominator: 1 }).value).toBe(
		"30",
	);
	expect(
		frameRateSelectOption({ numerator: 60000, denominator: 2000 }).value,
	).toBe("30");
});

test("non-preset rates remain visible without mutating the project rate", () => {
	const rate = Object.freeze({ numerator: 35, denominator: 2 });
	expect(frameRateSelectOption(rate)).toEqual({
		value: "custom",
		label: "35/2 fps (custom)",
	});
	expect(rate).toEqual({ numerator: 35, denominator: 2 });
});

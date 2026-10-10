import { expect, test } from "bun:test";
import { blazeCases, blazeSource, type BlazeSourceKind } from "./blaze-cases";
import { blazeExpected } from "./blaze-oracle";
import { blazeActivePixels, blazeRawThresholds } from "./blaze-browser-metrics";

test("every frozen aspect/source mode is oracle-active before any GPU execution", () => {
	for (const [width, height] of [
		[192, 128],
		[256, 96],
		[96, 256],
	])
		for (const kind of [
			"opaque",
			"holes",
			"transparent",
		] as BlazeSourceKind[]) {
			const source = blazeSource({ width, height, kind });
			for (const sample of blazeCases().filter((sample) =>
				["flame", "sparks", "smoke", "heat", "combined"].includes(sample.id),
			)) {
				const expected = blazeExpected({ source, width, height, ...sample });
				const count = blazeActivePixels(expected.pixels, source);
				if (kind === "transparent" && sample.id === "heat")
					expect(count).toBe(0);
				else
					expect(
						count,
						`${width}x${height} ${kind} ${sample.id}`,
					).toBeGreaterThanOrEqual(
						sample.id === "sparks"
							? blazeRawThresholds.minimumSparkActivePixels
							: blazeRawThresholds.minimumBroadActivePixels,
					);
			}
		}
});

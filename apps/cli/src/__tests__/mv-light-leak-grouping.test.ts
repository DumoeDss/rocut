import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { MV_RECIPE_POST_SOURCE } from "../../../../packages/editor-classic/src/services/renderer/programmatic/mv-recipe-post";

test("zero light leak does not split fractional color groups or introduce an RGBA8 boundary", () => {
	const grade = (delta: number) => ({
		effect: {
			kind: "grade",
			exposure: 0,
			contrast: 1,
			saturation: 1,
			lift: [delta, delta, delta],
			gain: [1 + delta, 1 + delta, 1 + delta],
		},
		seed: 3,
	});
	const leak = {
		effect: { kind: "lightLeak", amount: 0, alpha: "preserve" },
		seed: 3,
	};
	const run = (effects: unknown[]) => {
		const bytes = new Uint8ClampedArray([51, 101, 154, 128]);
		let reads = 0,
			writes = 0;
		const canvas = {
			width: 1,
			height: 1,
			getContext() {
				return {
					getImageData() {
						reads++;
						return { data: new Uint8ClampedArray(bytes) };
					},
					putImageData(image: { data: Uint8ClampedArray }) {
						writes++;
						bytes.set(image.data);
					},
				};
			},
		};
		runInNewContext(`${MV_RECIPE_POST_SOURCE}\napplyMvPost(canvas, effects);`, {
			canvas,
			effects,
		});
		return { bytes: [...bytes], reads, writes };
	};
	const baseline = run([grade(0.5 / 255), grade(-0.5 / 255)]);
	expect(run([grade(0.5 / 255), leak, grade(-0.5 / 255)])).toEqual(baseline);
	expect(baseline).toEqual({ bytes: [51, 101, 154, 128], reads: 1, writes: 1 });
	expect(run([leak])).toEqual({
		bytes: [51, 101, 154, 128],
		reads: 0,
		writes: 0,
	});
});

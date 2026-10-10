import { expect, test } from "bun:test";
import { blazeSource } from "./blaze-cases";
import { blazeNegativeControls } from "./blaze-browser-negatives";

test("independent pre-GPU negative controls cannot pass frozen RAW gates", () => {
	const results = blazeNegativeControls({
		source: blazeSource({ pattern: "stress" }),
		width: 192,
		height: 128,
	});
	for (const result of results)
		expect(result.rejected, JSON.stringify(result)).toBe(true);
	expect(results.length).toBe(37);
});

test("negative controls stay sensitive after transparent hidden RGB is canonicalized", () => {
	const source = blazeSource({ pattern: "stress" });
	for (let offset = 0; offset < source.length; offset += 4)
		if (source[offset + 3] === 0) source.fill(0, offset, offset + 4);
	for (const result of blazeNegativeControls({
		source,
		width: 192,
		height: 128,
	}))
		expect(result.rejected, JSON.stringify(result)).toBe(true);
});

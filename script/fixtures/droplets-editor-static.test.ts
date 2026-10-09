import { expect, test } from "bun:test";
import { inflateSync } from "node:zlib";
import {
	editorImage,
	editorChanges,
	editorParams,
} from "./droplets-editor-scene";
import { acceptsMetric, rgbMetric } from "./droplets-editor-export-decode.mjs";
import {
	assertPrivateDirectory,
	isIntegerPreview,
	previewViewports,
} from "./droplets-editor-lifecycle.mjs";

test("export geometry rejects fractional edges and freezes a finite vertical-only search", () => {
	const viewport = { width: 1440, height: 1000 };
	const bounds = { x: 401, y: 118, width: 638, height: 358 };
	expect(isIntegerPreview(bounds, viewport)).toBe(true);
	for (const key of ["x", "y", "width", "height"])
		expect(
			isIntegerPreview(
				{ ...bounds, [key]: bounds[key as keyof typeof bounds] + 1 / 64 },
				viewport,
			),
		).toBe(false);
	expect(isIntegerPreview({ ...bounds, y: 117.90625 }, viewport)).toBe(false);
	expect(isIntegerPreview({ ...bounds, x: 1000 }, viewport)).toBe(false);
	expect(isIntegerPreview(null, viewport)).toBe(false);
	expect(previewViewports).toHaveLength(128);
	expect(
		previewViewports.every(
			(item, index) => item.width === 1440 && item.height === 1000 + index,
		),
	).toBe(true);
	expect(
		Object.isFrozen(previewViewports) &&
			previewViewports.every(Object.isFrozen),
	).toBe(true);
});

test("editor acceptance directories cannot escape the isolated artifact tree", () => {
	expect(() =>
		assertPrivateDirectory("C:/tmps/rocut/run", "Fixture"),
	).not.toThrow();
	for (const path of [
		"",
		"relative",
		"C:/tmps",
		"C:/tmps/../users",
		"C:/tmps-other",
		"E:/rocut",
	])
		expect(() => assertPrivateDirectory(path, "Fixture")).toThrow();
});

test("Droplets UI asset is deterministic RGBA PNG with protected transparent edges", () => {
	const png = editorImage();
	expect(png).toEqual(editorImage());
	expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
	expect(png.readUInt32BE(16)).toBe(640);
	expect(png.readUInt32BE(20)).toBe(360);
	expect(png[24]).toBe(8);
	expect(png[25]).toBe(6);
	const data: Buffer[] = [];
	for (let offset = 8; offset < png.length; ) {
		const length = png.readUInt32BE(offset);
		if (png.toString("ascii", offset + 4, offset + 8) === "IDAT")
			data.push(png.subarray(offset + 8, offset + 8 + length));
		offset += length + 12;
	}
	const rows = inflateSync(Buffer.concat(data));
	expect(rows.length).toBe(360 * (640 * 4 + 1));
	const alphas = new Set<number>();
	for (let y = 0; y < 360; y++) {
		expect(rows[y * 2561]).toBe(0);
		for (let x = 0; x < 640; x++) {
			const offset = y * 2561 + 1 + x * 4;
			if (x < 32 || y < 32 || x >= 608 || y >= 328) {
				if (rows.subarray(offset, offset + 4).some((value) => value !== 0))
					throw Error("Nontransparent guard pixel");
			} else alphas.add(rows[offset + 3]);
		}
	}
	expect([...alphas].sort((a, b) => a - b)).toEqual([0, 64, 160, 255]);
	expect(editorChanges.map((item) => item.key).sort()).toEqual(
		Object.keys(editorParams).sort(),
	);
	expect(
		editorChanges.every(
			(item) =>
				item.value !== editorParams[item.key as keyof typeof editorParams],
		),
	).toBe(true);
});

test("effect mask rejects missing effect and repeated frame without background dilution", () => {
	const baseline = new Uint8Array(1200),
		first = new Uint8Array(1200),
		second = new Uint8Array(1200);
	first.fill(128, 0, 64 * 3);
	second.fill(64, 0, 64 * 3);
	expect(rgbMetric(first, first, baseline)).toEqual({
		meanRgb: 0,
		effectRgb: 0,
		effectPixels: 64,
	});
	expect(acceptsMetric(rgbMetric(first, first, baseline))).toBe(true);
	expect(acceptsMetric(rgbMetric(baseline, first, baseline))).toBe(false);
	const repeated = rgbMetric(first, second, baseline);
	expect(repeated.effectRgb).toBe(64);
	expect(repeated.effectPixels).toBe(64);
	expect(acceptsMetric(repeated)).toBe(false);
});

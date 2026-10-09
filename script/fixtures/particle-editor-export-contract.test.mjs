import assert from "node:assert/strict";
import { test } from "node:test";
import {
	assertUiGeometry,
	EDITOR_EXPORT_CONTRACT,
	pngDimensions,
} from "./particle-editor-export-contract.mjs";
import {
	acceptsProjectPixels,
	projectPixelMetrics,
} from "./particle-project-export-pixels.mjs";

function sample() {
	return {
		frame: 15,
		ticks: 60000,
		visible: { width: 640, height: 360 },
		geometry: {
			bounds: { x: 100, y: 100, width: 640, height: 360 },
			devicePixelRatio: 1,
			viewport: { width: 1440, height: 900 },
			backing: { width: 1920, height: 1080 },
			css: { transform: "none", objectFit: "fill", opacity: "1" },
			selection: [],
		},
	};
}
test("fixed full-duration and six UI sample coverage", () => {
	assert.equal(
		EDITOR_EXPORT_CONTRACT.frameCount * EDITOR_EXPORT_CONTRACT.ticksPerFrame,
		EDITOR_EXPORT_CONTRACT.durationTicks,
	);
	assert.deepEqual(EDITOR_EXPORT_CONTRACT.frames, [0, 15, 30, 60, 75, 120]);
	assert.equal(EDITOR_EXPORT_CONTRACT.thresholdRelaxationAllowed, false);
	assert.deepEqual(assertUiGeometry(sample()), { width: 640, height: 360 });
});
test("reject shifted metadata, selection, transform and upsampled/cropped UI geometry independently", () => {
	for (const alter of [
		(s) => s.ticks++,
		(s) => s.geometry.selection.push("particle-model"),
		(s) => (s.geometry.css.transform = "scale(2)"),
		(s) => (s.visible.width = 1921),
		(s) => (s.visible.height = 350),
		(s) => (s.geometry.bounds.width = 500),
		(s) => (s.geometry.bounds.x = 1400),
		(s) => (s.geometry.backing.width = 320),
	]) {
		const input = sample();
		alter(input);
		assert.throws(() => assertUiGeometry(input));
	}
});
test("PNG dimensions are actual IHDR dimensions, not caller inferred values", () => {
	const bytes = Buffer.alloc(24);
	Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
	bytes.write("IHDR", 12);
	bytes.writeUInt32BE(640, 16);
	bytes.writeUInt32BE(360, 20);
	assert.deepEqual(pngDimensions(bytes), { width: 640, height: 360 });
	bytes[0] = 0;
	assert.throws(() => pngDimensions(bytes));
});
test("blank GPU readback and stale .85 brightness cannot masquerade as a .55 actual UI reference", () => {
	const make = (value) =>
		Uint8Array.from({ length: 32 * 32 * 4 }, (_, i) =>
			i % 4 === 3 ? 255 : value,
		);
	const ui = make(55),
		blank = make(0),
		stale = make(85);
	assert.equal(
		acceptsProjectPixels(projectPixelMetrics(blank, ui), true),
		false,
	);
	assert.equal(
		acceptsProjectPixels(projectPixelMetrics(stale, ui), true),
		false,
	);
	assert.equal(acceptsProjectPixels(projectPixelMetrics(ui, ui), true), true);
});

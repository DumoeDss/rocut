import assert from "node:assert/strict";
import { test } from "node:test";
import {
	assertIntegerCanvasGeometry,
	integerGeometryPlan,
} from "./particle-editor-integer-geometry.mjs";

const fixture = () => ({
	bounds: { x: 481, y: 172, width: 478, height: 268 },
	viewport: { width: 1440, height: 1028 },
	devicePixelRatio: 1,
	backing: { width: 1920, height: 1080 },
	css: {
		transform: "none",
		objectFit: "fill",
		opacity: "1",
		...Object.fromEntries(
			[
				"borderLeftWidth",
				"borderTopWidth",
				"borderRightWidth",
				"borderBottomWidth",
				"paddingLeft",
				"paddingTop",
				"paddingRight",
				"paddingBottom",
			].map((key) => [key, "0px"]),
		),
	},
	scroll: { x: 0, y: 0 },
	fullscreen: false,
	zoomLabel: "25%",
	ancestors: [
		{
			content: { x: 400, y: 100, width: 640, height: 480 },
			transform: "none",
			opacity: "1",
			visibility: "visible",
			clipPath: "none",
			filter: "none",
			backdropFilter: "none",
			overflowX: "hidden",
			overflowY: "hidden",
		},
	],
});

test("integer content geometry accepts all edges without cropping", () => {
	assert.doesNotThrow(() => assertIntegerCanvasGeometry(fixture()));
	assert.deepEqual(
		integerGeometryPlan.viewportHeights,
		Array.from({ length: 64 }, (_, i) => 1000 + i),
	);
});
test("fractional location or dimensions cannot round into acceptance", () => {
	for (const key of ["x", "y", "width", "height"]) {
		const value = fixture();
		value.bounds[key] += 1 / 64;
		assert.throws(() => assertIntegerCanvasGeometry(value));
	}
});
test("original outward-rounded reference geometry is rejected", () => {
	const value = fixture();
	value.bounds = {
		x: 379.53125,
		y: 105.828125,
		width: 680.9375,
		height: 382.140625,
	};
	assert.throws(() => assertIntegerCanvasGeometry(value));
});
test("ancestor clipping, effects, canvas borders and undeclared viewports fail closed", () => {
	for (const edit of [
		(v) => {
			v.ancestors[0].content.width = 400;
		},
		(v) => {
			v.ancestors[0].opacity = "0.5";
		},
		(v) => {
			v.css.borderLeftWidth = "1px";
		},
		(v) => {
			v.viewport.height = 1064;
		},
		(v) => {
			v.fullscreen = true;
		},
		(v) => {
			v.zoomLabel = "Fit";
		},
	]) {
		const value = fixture();
		edit(value);
		assert.throws(() => assertIntegerCanvasGeometry(value));
	}
});

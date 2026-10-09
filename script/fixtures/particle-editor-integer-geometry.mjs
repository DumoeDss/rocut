import assert from "node:assert/strict";
import { join } from "node:path";
import { writeJson } from "../particle-c4-export-support.mjs";
import { poll } from "./stylized-fusion-checks.mjs";

// Freeze before any pixel comparison. This selects geometry, never image quality.
export const integerGeometryPlan = Object.freeze({
	version: 1,
	zoomPercent: 25,
	devicePixelRatio: 1,
	viewportWidth: 1440,
	viewportHeights: Object.freeze(
		Array.from({ length: 64 }, (_, i) => 1000 + i),
	),
	expectedCanvas: Object.freeze({ width: 478, height: 268 }),
	selectionRule:
		"First height in declared ascending order whose entire canvas occupies exact integer CSS/device pixels",
	correction:
		"Correct outward-rounded locator capture admitting the production parent border; no canvas-content crop, image fitting or threshold change",
});

export function assertIntegerCanvasGeometry(value) {
	const { bounds, viewport, devicePixelRatio, css, ancestors } = value;
	assert.equal(devicePixelRatio, 1);
	assert.deepEqual(value.backing, { width: 1920, height: 1080 });
	assert.equal(viewport.width, integerGeometryPlan.viewportWidth);
	assert.ok(integerGeometryPlan.viewportHeights.includes(viewport.height));
	assert.deepEqual(
		{ width: bounds.width, height: bounds.height },
		integerGeometryPlan.expectedCanvas,
	);
	for (const number of [
		bounds.x,
		bounds.y,
		bounds.width,
		bounds.height,
		bounds.x + bounds.width,
		bounds.y + bounds.height,
	])
		assert.ok(
			Number.isInteger(number),
			"All canvas edges and dimensions must be exact integer device pixels",
		);
	assert.ok(bounds.x >= 0 && bounds.y >= 0);
	assert.ok(bounds.x + bounds.width <= viewport.width);
	assert.ok(bounds.y + bounds.height <= viewport.height);
	assert.equal(css.transform, "none");
	assert.equal(css.objectFit, "fill");
	assert.equal(css.opacity, "1");
	for (const key of [
		"borderLeftWidth",
		"borderTopWidth",
		"borderRightWidth",
		"borderBottomWidth",
		"paddingLeft",
		"paddingTop",
		"paddingRight",
		"paddingBottom",
	])
		assert.equal(css[key], "0px");
	assert.equal(value.scroll.x, 0);
	assert.equal(value.scroll.y, 0);
	assert.equal(value.fullscreen, false);
	assert.equal(value.zoomLabel, "25%");
	for (const parent of ancestors) {
		assert.equal(parent.transform, "none");
		assert.equal(parent.opacity, "1");
		assert.equal(parent.visibility, "visible");
		assert.equal(parent.clipPath, "none");
		assert.equal(parent.filter, "none");
		assert.equal(parent.backdropFilter, "none");
		if (parent.overflowX !== "visible") {
			assert.ok(bounds.x >= parent.content.x);
			assert.ok(
				bounds.x + bounds.width <= parent.content.x + parent.content.width,
			);
		}
		if (parent.overflowY !== "visible") {
			assert.ok(bounds.y >= parent.content.y);
			assert.ok(
				bounds.y + bounds.height <= parent.content.y + parent.content.height,
			);
		}
	}
	return value;
}

export async function readIntegerCanvasGeometry(page, canvas) {
	return canvas.evaluate((node) => {
		const rect = (element) => {
			const value = element.getBoundingClientRect();
			return {
				x: value.x,
				y: value.y,
				width: value.width,
				height: value.height,
			};
		};
		const style = getComputedStyle(node);
		const css = Object.fromEntries(
			[
				"transform",
				"objectFit",
				"opacity",
				"borderLeftWidth",
				"borderTopWidth",
				"borderRightWidth",
				"borderBottomWidth",
				"paddingLeft",
				"paddingTop",
				"paddingRight",
				"paddingBottom",
			].map((key) => [key, style[key]]),
		);
		const ancestors = [];
		for (
			let parent = node.parentElement;
			parent;
			parent = parent.parentElement
		) {
			const bounds = rect(parent),
				computed = getComputedStyle(parent);
			ancestors.push({
				tag: parent.tagName,
				bounds,
				content: {
					x: bounds.x + parent.clientLeft,
					y: bounds.y + parent.clientTop,
					width: parent.clientWidth,
					height: parent.clientHeight,
				},
				...Object.fromEntries(
					[
						"transform",
						"opacity",
						"visibility",
						"clipPath",
						"filter",
						"backdropFilter",
						"overflowX",
						"overflowY",
						"borderLeftWidth",
						"borderTopWidth",
						"borderRightWidth",
						"borderBottomWidth",
						"borderLeftColor",
						"boxSizing",
					].map((key) => [key, computed[key]]),
				),
			});
		}
		return {
			bounds: rect(node),
			viewport: { width: innerWidth, height: innerHeight },
			devicePixelRatio,
			backing: { width: node.width, height: node.height },
			css,
			ancestors,
			scroll: { x: scrollX, y: scrollY },
			fullscreen: document.fullscreenElement !== null,
			zoomLabel: document
				.querySelector('[aria-label="Preview zoom"]')
				?.textContent?.trim(),
		};
	});
}

export async function prepareIntegerCanvasGeometry({ page, root, dimensions }) {
	const canvas = page
		.locator(
			`canvas[width="${dimensions.width}"][height="${dimensions.height}"]`,
		)
		.filter({ visible: true });
	const attempts = [];
	await writeJson(
		join(root, "integer-geometry-plan.json"),
		integerGeometryPlan,
	);
	// Genuine production control; do not alter DOM, style, renderer or stores.
	await page
		.getByRole("combobox", { name: "Preview zoom", exact: true })
		.click();
	await page.getByRole("option", { name: "25%", exact: true }).click();
	let selected;
	try {
		for (const height of integerGeometryPlan.viewportHeights) {
			await page.setViewportSize({
				width: integerGeometryPlan.viewportWidth,
				height,
			});
			// Resize can change fitScale while retaining the zoom multiplier.
			// Re-select through the visible production menu at every candidate.
			await page
				.getByRole("combobox", { name: "Preview zoom", exact: true })
				.click();
			await page.getByRole("option", { name: "25%", exact: true }).click();
			let last,
				stable = 0;
			const measured = await poll(async () => {
				const current = await readIntegerCanvasGeometry(page, canvas);
				const serial = JSON.stringify(current);
				stable = serial === last ? stable + 1 : 0;
				last = serial;
				return stable >= 2 ? current : false;
			}, 10000);
			try {
				assertIntegerCanvasGeometry(measured);
				attempts.push({
					viewport: measured.viewport,
					bounds: measured.bounds,
					zoomLabel: measured.zoomLabel,
					accepted: true,
				});
				selected = measured;
				break;
			} catch (error) {
				attempts.push({
					viewport: measured.viewport,
					bounds: measured.bounds,
					zoomLabel: measured.zoomLabel,
					accepted: false,
					reason: error.message,
				});
			}
		}
		assert.ok(
			selected,
			"No integer, full-canvas geometry in the predeclared viewport candidates; no pixel-driven fallback allowed",
		);
		await writeJson(join(root, "integer-geometry-frozen.json"), selected);
		return { canvas, frozen: selected };
	} finally {
		await writeJson(join(root, "integer-geometry-attempts.json"), attempts);
	}
}

export async function assertFrozenIntegerCanvas({ page, canvas, frozen }) {
	const measured = assertIntegerCanvasGeometry(
		await readIntegerCanvasGeometry(page, canvas),
	);
	assert.deepEqual(
		measured,
		frozen,
		"Geometry cannot change after selection and before any reference pixel comparison",
	);
	const covered = await canvas.evaluate((node) => {
		const bounds = node.getBoundingClientRect(),
			opaque = [];
		const transparent = (color) =>
			color === "transparent" || /^rgba\([^)]*,\s*0\)$/.test(color);
		for (const fx of [0, 0.25, 0.5, 0.75, 1])
			for (const fy of [0, 0.25, 0.5, 0.75, 1]) {
				const x = bounds.x + 0.5 + fx * (bounds.width - 1),
					y = bounds.y + 0.5 + fy * (bounds.height - 1);
				const stack = document.elementsFromPoint(x, y),
					at = stack.indexOf(node);
				if (at < 0) {
					opaque.push({ x, y, reason: "Canvas absent from hit-test stack" });
					continue;
				}
				for (const cover of stack.slice(0, at)) {
					if (cover.contains(node) || node.contains(cover)) continue;
					const css = getComputedStyle(cover);
					if (
						!transparent(css.backgroundColor) ||
						css.backgroundImage !== "none" ||
						css.boxShadow !== "none" ||
						css.filter !== "none" ||
						css.backdropFilter !== "none" ||
						css.outlineStyle !== "none" ||
						[
							css.borderLeftWidth,
							css.borderTopWidth,
							css.borderRightWidth,
							css.borderBottomWidth,
						].some((v) => v !== "0px") ||
						cover.textContent?.trim()
					)
						opaque.push({
							x,
							y,
							tag: cover.tagName,
							role: cover.getAttribute("role"),
							reason: "Non-transparent DOM above canvas",
						});
				}
			}
		return opaque;
	});
	assert.deepEqual(
		covered,
		[],
		"Full-canvas perimeter and interior must be unobscured by other visible UI",
	);
	return measured;
}

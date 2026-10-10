import { expect, test } from "bun:test";
import { MV_ORDERED_RASTER_SOURCE } from "../mv-ordered-raster";

interface RasterSettings {
	blurPx: number;
	smoothing: boolean;
	smoothingQuality: string;
	contrast?: unknown;
}
const filter: (settings: RasterSettings) => string = new Function(
	`${MV_ORDERED_RASTER_SOURCE}; return mvOrderedBlitFilter;`,
)();
const settings = { blurPx: 4, smoothing: true, smoothingQuality: "low" };

test("one draw filter preserves blur-before-contrast and legacy blur-only spelling", () => {
	expect(filter({ ...settings, contrast: 14 })).toBe("blur(4px) contrast(14)");
	expect(filter(settings)).toBe("blur(4px)");
	expect(filter({ ...settings, blurPx: 0 })).toBe("none");
	expect(filter({ ...settings, blurPx: 0, contrast: 0 })).toBe("contrast(0)");
});

test("ordered raster rejects unbounded or string-valued filter parameters", () => {
	for (const contrast of [null, "14", -1, 33, Infinity, NaN])
		expect(() => filter({ ...settings, contrast })).toThrow("native blit");
	for (const blurPx of [-1, 17, Infinity, NaN])
		expect(() => filter({ ...settings, blurPx })).toThrow("native blit");
});

test("scaled Canvas copy reads native matrix and adds padding before downscaling", () => {
	const events: unknown[] = [];
	const copy: (context: object, operation: object) => void = new Function(
		`${MV_ORDERED_RASTER_SOURCE}; return mvCopyScaledTransform;`,
	)();
	const context = {
		getTransform: () => {
			events.push("read");
			return { a: 1.2, b: 0.4, c: -0.6, d: 1.4, e: -120, f: 36 };
		},
		setTransform: (...values: number[]) => events.push(values),
	};
	copy(context, { scale: 0.25, offset: [60, 60] });
	expect(events).toEqual(["read", [0.3, 0.1, -0.15, 0.35, -15, 24]]);
	for (const operation of [
		{ scale: 0, offset: [60, 60] },
		{ scale: 9, offset: [60, 60] },
		{ scale: 0.25, offset: [60] },
		{ scale: 0.25, offset: [Infinity, 60] },
	])
		expect(() => copy(context, operation)).toThrow("scaled Canvas transform");
});

test("gradient brush creation uses a separate CTM and restores draw state without copying it", () => {
	const events: unknown[] = [];
	const draw: (context: object, command: object) => void = new Function(
		"mvEmberTransform",
		"mvEmberStyle",
		`${MV_ORDERED_RASTER_SOURCE}; return mvGradientRect;`,
	)(
		(_context: object, command: object) => events.push(command),
		() => "created-brush",
	);
	const context = {
		save: () => events.push("save"),
		restore: () => events.push("restore"),
		fillRect: (...rect: number[]) => events.push(rect),
		getTransform: () => {
			throw Error("Gradient draw must not copy the native draw CTM");
		},
		fillStyle: "old",
	};
	const transform = [1, 0, 0, 1, 0, 0];
	draw(context, {
		styleTransform: transform,
		styleOperations: [{ kind: "scale", factors: [1.2, 1.2] }],
		paint: { kind: "fill", style: {}, composite: "source-over", opacity: 0.9 },
		rect: [0, 0, 1920, 1080],
	});
	expect(events).toEqual([
		"save",
		{ transform, operations: [{ kind: "scale", factors: [1.2, 1.2] }] },
		"restore",
		[0, 0, 1920, 1080],
	]);
	expect(context.fillStyle).toBe("created-brush");
});

test("gradient brush failure restores the drawing state and never fills a rectangle", () => {
	const events: string[] = [];
	const draw: (context: object, command: object) => void = new Function(
		"mvEmberTransform",
		"mvEmberStyle",
		`${MV_ORDERED_RASTER_SOURCE}; return mvGradientRect;`,
	)(
		() => {},
		() => {
			throw Error("brush creation failed");
		},
	);
	const context = {
		save: () => events.push("save"),
		restore: () => events.push("restore"),
		fillRect: () => events.push("unexpected fill"),
	};
	expect(() => draw(context, { paint: { kind: "fill" } })).toThrow(
		"brush creation failed",
	);
	expect(events).toEqual(["save", "restore"]);
	expect(() => draw(context, { paint: { kind: "stroke" } })).toThrow(
		"requires fill paint",
	);
	expect(events).toEqual(["save", "restore"]);
});

import assert from "node:assert/strict";
import test from "node:test";
import * as renderer from "../../packages/editor-classic/src/services/renderer/programmatic/mv-memories-renderer.ts";

const { MV_MEMORIES_RENDERER_SOURCE } = renderer.default ?? renderer;

const replay = new Function(
	`${MV_MEMORIES_RENDERER_SOURCE}; return drawMvMemories;`,
)();
const space = { transform: [1, 0, 0, 1, 0, 0], operations: [] };
const raster = {
	bindingSha256: "b",
	part: "test",
	width: 2,
	height: 2,
	rgbaSha256: "p",
};
const paint = {
	kind: "fill",
	composite: "source-over",
	opacity: 1,
	style: { kind: "solid", color: [1, 0, 0, 1] },
};
function canvas(log) {
	const surface = { width: 2, height: 2 };
	const ctx = new Proxy(
		{ canvas: surface },
		{
			get(target, key) {
				if (key in target) return target[key];
				return (...args) => {
					log.push([key, ...args]);
				};
			},
			set(target, key, value) {
				log.push([key, value]);
				target[key] = value;
				return true;
			},
		},
	);
	surface.getContext = () => ctx;
	return surface;
}

test("Memories replay keeps affine/filter, opaque pixels and recursive lifetimes native", () => {
	const log = [],
		allocated = [];
	const root = canvas(log);
	const pixels = { width: 2, height: 2, data: new Uint8ClampedArray(16) };
	const commands = [
		{
			kind: "surface",
			id: "outer",
			size: [2, 2],
			commands: [
				{
					kind: "surface",
					id: "inner",
					size: [2, 2],
					commands: [{ kind: "pixels", raster }],
				},
				{
					kind: "blit",
					...space,
					surface: "inner",
					sourceRect: [0, 0, 2, 2],
					destinationRect: [0, 0, 2, 2],
					composite: "source-over",
					opacity: 1,
				},
				{ kind: "releaseSurface", surface: "inner" },
			],
		},
		{
			kind: "filteredRect",
			...space,
			affine: [1, 0.2, -0.62, 1, 0, 0],
			rect: [0, 0, 2, 2],
			paint,
			blurPx: 2.6,
		},
		{ kind: "roundRect", ...space, rect: [0, 0, 2, 2], radius: 1, paint },
		{
			kind: "preparedImage",
			...space,
			raster,
			destinationRect: [0, 0, 2, 2],
			composite: "source-over",
			opacity: 1,
			smoothingQuality: "high",
		},
		{ kind: "releaseSurface", surface: "outer" },
	];
	replay(
		root.getContext(),
		{ commands },
		{ memoriesPixels: () => pixels, memoriesRaster: () => root },
		() => {
			const surface = canvas(log);
			allocated.push(surface);
			return surface;
		},
	);
	assert.ok(
		log.some((call) => call[0] === "putImageData" && call[1] === pixels),
	);
	const affine = log.findIndex((call) => call[0] === "transform");
	const filter = log.findIndex(
		(call) => call[0] === "filter" && call[1] === "blur(2.6px)",
	);
	const fill = log.findIndex((call) => call[0] === "fillRect");
	assert.ok(affine >= 0 && filter > affine && fill > filter);
	assert.deepEqual(log[affine], ["transform", 1, 0.2, -0.62, 1, 0, 0]);
	assert.ok(log.some((call) => call[0] === "roundRect"));
	assert.equal(allocated.length, 2);
	assert.ok(
		allocated.every((surface) => surface.width === 1 && surface.height === 1),
	);
});

test("Memories never resolves an authored URL or invents absent prepared pixels", () => {
	const log = [],
		root = canvas(log);
	assert.throws(
		() =>
			replay(root.getContext(), { commands: [{ kind: "pixels", raster }] }, {}),
		/admitted RGBA owner/,
	);
	assert.throws(
		() =>
			replay(
				root.getContext(),
				{ commands: [{ kind: "preparedImage", ...space, raster }] },
				{},
			),
		/admitted raster owner/,
	);
	assert.throws(
		() =>
			replay(
				root.getContext(),
				{ commands: [{ kind: "pixels", raster }] },
				{
					memoriesPixels: () => ({
						width: 1,
						height: 2,
						data: new Uint8ClampedArray(8),
					}),
				},
			),
		/dimensions mismatch/,
	);
});

test("released scratch IDs may be reused by successive photos", () => {
	const log = [],
		root = canvas(log),
		allocated = [];
	const commands = [];
	for (let i = 0; i < 4; i++) {
		commands.push({
			kind: "surface",
			id: "memories-live",
			size: [2, 2],
			commands: [],
		});
		commands.push({ kind: "releaseSurface", surface: "memories-live" });
	}
	replay(root.getContext(), { commands }, {}, () => {
		const surface = canvas(log);
		allocated.push(surface);
		return surface;
	});
	assert.equal(allocated.length, 4);
	assert.ok(
		allocated.every((surface) => surface.width === 1 && surface.height === 1),
	);
});

test("font measurement replays only Rust-requested scalar/full strings with exact admitted faces", () => {
	const measure = new Function(
		`${MV_MEMORIES_RENDERER_SOURCE}; return measureMvMemoriesFonts;`,
	)();
	const log = [],
		root = canvas(log),
		ctx = root.getContext();
	ctx.measureText = (text) => {
		log.push(["measureText", text]);
		return { width: text === "😀" ? 40 : 42 };
	};
	const request = {
		font: "caption.woff2",
		fontSize: 40,
		weight: 600,
		texts: ["😀", "4.17"],
	};
	const assets = {
		descriptor: () => ({
			kind: "font",
			font: { family: "Admitted Klee One", style: "normal", weight: 600 },
		}),
	};
	const facts = measure(ctx, [request], assets);
	assert.equal(facts[0].widths["😀"], 40);
	assert.equal(facts[0].widths["4.17"], 42);
	assert.deepEqual(
		log.filter(
			(call) => call[0] === "measureText" && typeof call[1] === "string",
		),
		[
			["measureText", "😀"],
			["measureText", "4.17"],
		],
	);
	assert.throws(
		() =>
			measure(ctx, [request], {
				descriptor: () => ({
					kind: "font",
					font: { family: "Wrong", style: "normal", weight: 400 },
				}),
			}),
		/exact admitted font face/,
	);
});

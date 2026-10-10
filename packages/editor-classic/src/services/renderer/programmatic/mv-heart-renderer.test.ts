import { expect, test } from "bun:test";
import type {
	MvHeartPlan,
	MvHeartSurfaceDraw,
} from "../../../../../editor-contracts/src/mv-heart-plan";
import { heartRendererFixture } from "./mv-heart-renderer-test-fixture";
const transform = [1, 0, 0, 1, 0, 0] as const;
const paint = {
	kind: "stroke",
	style: { kind: "solid", color: [1, 0.5, 0, 1] },
	width: 26,
	cap: "butt",
	join: "miter",
	opacity: 0.5,
	composite: "source-over",
} as const;
const filtered = {
	kind: "filteredPath",
	transform,
	operations: [],
	path: [
		{ kind: "moveTo", point: [2, 4] },
		{ kind: "lineTo", point: [8, 16] },
	],
	paints: [paint],
	blurPx: 10,
} as const satisfies MvHeartSurfaceDraw;
const prepared = {
	kind: "preparedImage",
	image: {
		binding: {
			source: {
				id: "heart",
				kind: "image",
				mimeType: "image/png",
				byteLength: 1,
				sha256: "a".repeat(64),
				attachmentKey: `programmatic-sha256-${"a".repeat(64)}`,
			},
			decodedWidth: 300,
			decodedHeight: 600,
			decodedRgbaSha256: "b".repeat(64),
			decoder: "canvas2d-srgb-unpremultiplied-rgba8-v1",
			algorithm: "heart-components-v1",
		},
		part: { kind: "body" },
		width: 300,
		height: 600,
		rgbaSha256: "c".repeat(64),
	},
	sourceRect: [0, 0, 300, 600],
	destinationRect: [-150, -300, 300, 600],
	transform,
	operations: [{ kind: "translate", offset: [13, 17] }],
	clip: null,
	composite: "lighter",
	opacity: 0.7,
	smoothing: false,
	smoothingQuality: "low",
} as const satisfies MvHeartSurfaceDraw;
function blit(surface: string): MvHeartSurfaceDraw {
	return {
		kind: "blit",
		surface,
		transform,
		operations: [],
		clip: null,
		raster: null,
		sourceRect: [0, 0, 8, 9],
		destinationRect: [10, 20, 8, 9],
		opacity: 1,
		composite: "source-over",
	};
}
const plan: MvHeartPlan = {
	commands: [
		{
			kind: "surface",
			id: "heart-piece-1",
			size: [300, 600],
			commands: [prepared],
		},
		blit("heart-piece-1"),
		{ kind: "releaseSurface", surface: "heart-piece-1" },
	],
	rasterBudgetBytes: 1024,
};
test("actual Heart renderer delegates complete prepared identity and exact native crop/CTM", () => {
	const io = heartRendererFixture();
	io.draw(plan);
	expect(io.requested).toEqual([prepared.image]);
	const image = io.events.find((event) => event.op === "drawImage");
	expect(image?.args).toEqual([
		io.bitmap,
		0,
		0,
		300,
		600,
		-150,
		-300,
		300,
		600,
	]);
	expect(image?.state).toMatchObject({
		globalAlpha: 0.7,
		globalCompositeOperation: "lighter",
		imageSmoothingEnabled: false,
		transform: [
			["setTransform", ...transform],
			["translate", 13, 17],
		],
	});
	expect(io.closes()).toBe(0);
	expect([io.canvases[1]!.width, io.canvases[1]!.height]).toEqual([1, 1]);
	expect(io.output.ctx.stack).toHaveLength(0);
});
test("filteredPath is a native Canvas filter, not a shadow or bitmap post-blur", () => {
	const io = heartRendererFixture();
	io.draw({
		commands: [
			{ kind: "surface", id: "night", size: [64, 64], commands: [filtered] },
			{ kind: "releaseSurface", surface: "night" },
		],
	});
	expect(io.events.find((event) => event.op === "stroke")?.state).toMatchObject(
		{
			filter: "blur(10px)",
			shadowColor: "rgba(0,0,0,0)",
			globalAlpha: 0.5,
			lineWidth: 26,
		},
	);
	expect(io.events.some((event) => event.op === "drawImage")).toBe(false);
	expect(io.output.ctx.filter).toBeUndefined();
	const invalid = heartRendererFixture();
	expect(() => invalid.draw({ commands: [filtered] })).toThrow(
		"scratch target",
	);
	expect(invalid.output.ctx.stack).toHaveLength(0);
});
test("missing/substituted prepared providers and invalid filter payloads unwind without image fallback", () => {
	for (const missing of [true, false]) {
		const io = heartRendererFixture();
		Object.assign(io.assets, {
			preparedImage: missing ? undefined : () => ({ width: 1, height: 1 }),
		});
		expect(() => io.draw(plan)).toThrow(
			missing ? "prepared-image owner" : "dimensions mismatch",
		);
		expect(io.events.some((event) => event.op === "drawImage")).toBe(false);
		expect(io.output.ctx.stack).toHaveLength(0);
		for (const canvas of io.canvases.slice(1))
			expect([canvas.width, canvas.height]).toEqual([1, 1]);
	}
	for (const blurPx of [-1, 0, 9, 11, 17, NaN]) {
		const io = heartRendererFixture();
		expect(() =>
			io.draw({
				commands: [
					{
						kind: "surface",
						id: "invalid-filter",
						size: [64, 64],
						commands: [{ ...filtered, blurPx }],
					},
				],
			}),
		).toThrow("filtered path");
		expect(io.events.some((event) => event.op === "stroke")).toBe(false);
		expect(io.output.ctx.stack).toHaveLength(0);
		expect([io.canvases[1]!.width, io.canvases[1]!.height]).toEqual([1, 1]);
	}
});
test("quadratic paths and native shadow state remain distinct from CSS filters", () => {
	const io = heartRendererFixture();
	io.draw({
		commands: [
			{
				kind: "path",
				transform,
				operations: [],
				path: [
					{ kind: "moveTo", point: [0, 0] },
					{ kind: "quadraticCurveTo", control: [1, 2], point: [3, 4] },
				],
				paints: [paint],
			},
			{
				kind: "shadowPath",
				transform,
				operations: [],
				clip: null,
				path: filtered.path,
				paints: [paint],
				shadow: { color: [1, 0.25, 0, 0.8], blurPx: 4, offset: [0, 0] },
			},
		],
	});
	expect(
		io.events.find((event) => event.op === "quadraticCurveTo")?.args,
	).toEqual([1, 2, 3, 4]);
	expect(
		io.events.filter((event) => event.op === "stroke")[1]?.state,
	).toMatchObject({
		filter: "none",
		shadowBlur: 4,
		shadowColor: "rgba(255,63.75,0,0.8)",
	});
	expect(io.output.ctx.stack).toHaveLength(0);
});
test("owned IDs cannot be reused, sampled dead/self/future or released inside children", () => {
	const surface = {
		kind: "surface",
		id: "piece-1",
		size: [8, 9],
		commands: [],
	};
	const release = { kind: "releaseSurface", surface: "piece-1" };
	for (const commands of [
		[release],
		[blit("future")],
		[surface, release, blit("piece-1")],
		[surface, release, surface],
		[{ ...surface, commands: [blit("piece-1")] }],
		[{ ...surface, commands: [release] }],
		[
			surface,
			{
				kind: "appendSurface",
				surface: "piece-1",
				commands: [blit("piece-1")],
			},
		],
	]) {
		const io = heartRendererFixture();
		expect(() => io.draw({ commands })).toThrow();
		expect(io.output.ctx.stack).toHaveLength(0);
		for (const canvas of io.canvases.slice(1))
			expect([canvas.width, canvas.height]).toEqual([1, 1]);
		expect(io.closes()).toBe(0);
	}
});
test("return and throw at every iterator boundary release scratch, not provider assets", () => {
	// Prepared child, surface publication, blit, explicit release: four atomic yields.
	for (const mode of ["return", "throw"] as const)
		for (let boundary = 1; boundary <= 4; boundary++) {
			const io = heartRendererFixture(),
				steps = io.steps(plan);
			for (let i = 0; i < boundary; i++) expect(steps.next().done).toBe(false);
			if (mode === "return") expect(steps.return().done).toBe(true);
			else expect(() => steps.throw(Error("cancelled"))).toThrow("cancelled");
			expect(steps.next().done).toBe(true);
			expect(io.output.ctx.stack).toHaveLength(0);
			for (const canvas of io.canvases.slice(1))
				expect([canvas.width, canvas.height]).toEqual([1, 1]);
			expect(io.closes()).toBe(0);
		}
});
test("admitted Sky can reuse a released sprite slot but never a live/self/future slot", () => {
	const surface = {
		kind: "surface",
		id: "sky-piece",
		size: [8, 9],
		commands: [],
	};
	const release = { kind: "releaseSurface", surface: "sky-piece" };
	const io = heartRendererFixture({ reuseReleasedIds: true });
	io.draw({
		commands: [
			surface,
			blit("sky-piece"),
			release,
			surface,
			blit("sky-piece"),
			release,
		],
	});
	expect(io.events.filter((event) => event.op === "drawImage")).toHaveLength(2);
	expect(io.canvases).toHaveLength(3);
	for (const canvas of io.canvases.slice(1))
		expect([canvas.width, canvas.height]).toEqual([1, 1]);
	for (const commands of [
		[surface, surface],
		[blit("sky-piece")],
		[surface, release, blit("sky-piece")],
		[{ ...surface, commands: [blit("sky-piece")] }],
	]) {
		const invalid = heartRendererFixture({ reuseReleasedIds: true });
		expect(() => invalid.draw({ commands })).toThrow();
		expect(invalid.output.ctx.stack).toHaveLength(0);
	}
});

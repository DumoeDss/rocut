import { MV_MESH_RENDERER_SOURCE } from "../../packages/editor-classic/src/services/renderer/programmatic/mv-mesh-renderer";
import type { MeshPixelComparison } from "./mesh-scenes-contract";
import { assert, comparePixels, sampleRgba } from "./mesh-scenes-support.mjs";

type Pair = [number, number];
type Pose = "quad" | "triangle" | "tilted";
type Controls = {
	pose?: Pose;
	colorOffset?: Pair | undefined;
	opacity?: number;
	brightness?: number;
	inputIndex?: number;
};
type Face = {
	vertices: { position: Pair; uv: Pair; w: number }[];
	brightness: number;
	opacity: number;
	inputIndex: number;
	colorOffset?: Pair | undefined;
};
type DrawMesh = (
	context: OffscreenCanvasRenderingContext2D,
	faces: Face[],
	images: OffscreenCanvas[],
	width: number,
	height: number,
) => void;
interface RefractionEvidence {
	comparisons: MeshPixelComparison[];
	variants: {
		name: string;
		changedPixels: number;
		emptyFallback: number;
		outsideFallback: number;
	}[];
	renders: number;
	alphaInvariant: true;
	inputsUnchanged: true;
	zeroOffsetCompatible: true;
}
const WIDTH = 128,
	HEIGHT = 64;

function makeTexture(index: number) {
	const canvas = new OffscreenCanvas(WIDTH, HEIGHT);
	const context = canvas.getContext("2d")!;
	const image = context.createImageData(WIDTH, HEIGHT);
	for (let y = 0; y < HEIGHT; y++)
		for (let x = 0; x < WIDTH; x++) {
			const offset = (y * WIDTH + x) * 4;
			const checker = (Math.floor(x / 8) + Math.floor(y / 8)) % 2;
			const hole =
				index === 0
					? x >= 32 && x < 48 && y >= 24 && y < 40
					: x >= 12 && x < 28 && y >= 12 && y < 28;
			image.data.set(
				index === 0
					? [24 + x, 20 + 3 * y, checker ? 210 : 30, 255]
					: [220 - 2 * y, 200 - x, checker ? 45 : 185, 255],
				offset,
			);
			const clearBorder =
				index === 0 && (x < 2 || y < 2 || x >= WIDTH - 2 || y >= HEIGHT - 2);
			image.data[offset + 3] =
				hole || clearBorder
					? 0
					: (index === 0 ? x >= WIDTH / 2 : y >= HEIGHT / 2)
						? 128
						: 255;
		}
	context.putImageData(image, 0, 0);
	return { canvas, pixels: context.getImageData(0, 0, WIDTH, HEIGHT).data };
}

function makeFace(controls: Controls): Face {
	const corners: Pair[] =
		controls.pose === "triangle"
			? [
					[0, 0],
					[1, 0],
					[0, 1],
				]
			: [
					[0, 0],
					[1, 0],
					[1, 1],
					[0, 1],
				];
	const face: Face = {
		vertices: corners.map(([u, v]) => {
			const w = controls.pose === "tilted" ? 1 - 0.4 * u : 1;
			return {
				position: [(WIDTH * u) / w, HEIGHT * (0.5 + (v - 0.5) / w)],
				uv: [u, v],
				w,
			};
		}),
		brightness: controls.brightness ?? 1,
		opacity: controls.opacity ?? 1,
		inputIndex: controls.inputIndex ?? 0,
	};
	if (Object.hasOwn(controls, "colorOffset"))
		face.colorOffset = controls.colorOffset;
	return face;
}

function oracle(pixels: Uint8ClampedArray, controls: Controls) {
	const result = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
	let emptyFallback = 0,
		outsideFallback = 0;
	const [dx, dy] = controls.colorOffset ?? [0, 0];
	for (let y = 0; y < HEIGHT; y++)
		for (let x = 0; x < WIDTH; x++) {
			let u = (x + 0.5) / WIDTH,
				v = (y + 0.5) / HEIGHT;
			if (controls.pose === "triangle" && u + v >= 1) continue;
			// Inverse of the fixed test camera, independent of production vertices or plane coefficients.
			if (controls.pose === "tilted") {
				u /= 1 + 0.4 * u;
				v = 0.5 + (v - 0.5) * (1 - 0.4 * u);
			}
			const base = sampleRgba(pixels, WIDTH, HEIGHT, u, v);
			const inside = u + dx >= 0 && u + dx <= 1 && v + dy >= 0 && v + dy <= 1;
			const shifted = inside
				? sampleRgba(pixels, WIDTH, HEIGHT, u + dx, v + dy)
				: null;
			if (base[3] > 0 && (dx !== 0 || dy !== 0)) {
				if (!inside) outsideFallback++;
				else if (shifted?.[3] === 0) emptyFallback++;
			}
			const color = shifted && shifted[3] > 0 ? shifted : base;
			const shade = controls.brightness ?? 1;
			result.set(
				[
					color[0] * shade,
					color[1] * shade,
					color[2] * shade,
					base[3] * (controls.opacity ?? 1),
				],
				(y * WIDTH + x) * 4,
			);
		}
	return { pixels: result, emptyFallback, outsideFallback };
}

function equalBytes(a: Uint8ClampedArray, b: Uint8ClampedArray) {
	return a.length === b.length && a.every((value, index) => value === b[index]);
}

export async function checkMeshRefraction(): Promise<RefractionEvidence> {
	// Only the checked-in renderer is evaluated; fixtures cannot supply authored code.
	const draw = new Function(
		`${MV_MESH_RENDERER_SOURCE}\nreturn drawMvMesh;`,
	)() as DrawMesh;
	const textures = [makeTexture(0), makeTexture(1)];
	const comparisons: MeshPixelComparison[] = [],
		variants: RefractionEvidence["variants"] = [];
	let renders = 0;
	const render = (controls: Controls) => {
		const output = new OffscreenCanvas(WIDTH, HEIGHT),
			context = output.getContext("2d")!;
		const faces = [makeFace(controls)],
			before = JSON.stringify(faces);
		try {
			draw(
				context,
				faces,
				textures.map((texture) => texture.canvas),
				WIDTH,
				HEIGHT,
			);
			assert(
				JSON.stringify(faces) === before,
				"Refraction mutated its face inputs",
			);
			renders++;
			return context.getImageData(0, 0, WIDTH, HEIGHT).data;
		} finally {
			output.width = 1;
			output.height = 1;
		}
	};
	const cases: [string, Controls][] = [
		["missing offset", {}],
		["undefined offset", { colorOffset: undefined }],
		["zero offset", { colorOffset: [0, 0] }],
		[
			"positive offset and transparent fallback",
			{ colorOffset: [16 / WIDTH, 0] },
		],
		[
			"negative fractional offset",
			{ colorOffset: [-7.5 / WIDTH, -3.25 / HEIGHT] },
		],
		["outside fallback", { colorOffset: [2, 2], inputIndex: 1 }],
		["half opacity", { colorOffset: [16 / WIDTH, 0], opacity: 0.5 }],
		["shaded color", { colorOffset: [16 / WIDTH, 0], brightness: 0.4 }],
		["source B", { colorOffset: [16 / WIDTH, 0], inputIndex: 1 }],
		["triangle", { colorOffset: [16 / WIDTH, 0], pose: "triangle" }],
		[
			"perspective quad",
			{ colorOffset: [-7.5 / WIDTH, -3.25 / HEIGHT], pose: "tilted" },
		],
	];
	let missing: Uint8ClampedArray | undefined;
	try {
		for (const [name, controls] of cases) {
			const actual = render(controls),
				baseline = render({ ...controls, colorOffset: undefined });
			const expected = oracle(
				textures[controls.inputIndex ?? 0].pixels,
				controls,
			);
			comparisons.push(
				comparePixels(actual, expected.pixels, {
					label: `Mesh refraction ${name}`,
					maxPremul: 5,
					maxAlpha: 3,
					meanPremul: 1.5,
					minPixels: WIDTH * HEIGHT,
				}),
			);
			let changedPixels = 0;
			for (let offset = 0; offset < actual.length; offset += 4) {
				assert(
					actual[offset + 3] === baseline[offset + 3],
					`${name}: refraction changed alpha`,
				);
				if (controls.pose !== "tilted")
					assert(
						actual[offset + 3] === expected.pixels[offset + 3],
						`${name}: identity alpha mismatch`,
					);
				if (
					[0, 1, 2].some(
						(channel) =>
							Math.abs(
								((actual[offset + channel] - baseline[offset + channel]) *
									actual[offset + 3]) /
									255,
							) > 3,
					)
				)
					changedPixels++;
			}
			if (name === "missing offset") missing = actual;
			if (name === "undefined offset" || name === "zero offset")
				assert(
					missing && equalBytes(actual, missing),
					`${name}: compatibility changed pixels`,
				);
			if (name === "outside fallback")
				assert(
					equalBytes(actual, baseline) && expected.outsideFallback > 1000,
					"Outside UV did not fall back to base color",
				);
			else if (controls.colorOffset?.some((value) => value !== 0))
				assert(
					changedPixels > 100,
					`${name}: offset did not visibly affect colors`,
				);
			if (name === "positive offset and transparent fallback")
				assert(
					expected.emptyFallback > 100,
					"Missing transparent refraction fallback coverage",
				);
			variants.push({
				name,
				changedPixels,
				emptyFallback: expected.emptyFallback,
				outsideFallback: expected.outsideFallback,
			});
		}
		for (const texture of textures)
			assert(
				equalBytes(
					texture.pixels,
					texture.canvas.getContext("2d")!.getImageData(0, 0, WIDTH, HEIGHT)
						.data,
				),
				"Refraction mutated a source texture",
			);
		return {
			comparisons,
			variants,
			renders,
			alphaInvariant: true,
			inputsUnchanged: true,
			zeroOffsetCompatible: true,
		};
	} finally {
		for (const { canvas } of textures) {
			canvas.width = 1;
			canvas.height = 1;
		}
	}
}

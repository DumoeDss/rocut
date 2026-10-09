import {
	assert,
	comparePixels,
	freshMeshImage,
	imagePixels,
	sceneSource,
} from "./mesh-scenes-support.mjs";
import { rasterMesh } from "./mesh-scenes-mesh-oracle.mjs";

const corners = [
	[1, 1],
	[0, 2],
	[-1, 1],
	[-1, -1],
	[0, -2],
	[1, -1],
];
const random = (seed, key) => {
	let n = (seed ^ Math.imul(key, 374761393)) >>> 0;
	n = Math.imul(n ^ (n >>> 13), 1274126177) >>> 0;
	return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};
const baseSettings = () => ({
	image: "mesh-a.png",
	rect: [0, 0, 1, 1],
	fit: "stretch",
	size: 0.2,
	lift: 0.65,
	tilt: 0.65,
	gap: 0.12,
	cycles: 1.5,
	perspective: 0.7,
	shading: 0.7,
	opacity: 0.72,
});
const scene = (settings) => ({
	kind: "hexFloat",
	role: "foreground",
	settings,
	span: { startFrame: 0, durationFrames: 24 },
	easing: "linear",
});

async function texture(image, settings, width, height) {
	const bitmap = await freshMeshImage(image);
	try {
		const canvas = new OffscreenCanvas(width, height),
			ctx = canvas.getContext("2d");
		const [x, y, w, h] = settings.rect.map(
			(v, i) => v * (i % 2 === 0 ? width : height),
		);
		ctx.save();
		ctx.beginPath();
		ctx.rect(x, y, w, h);
		ctx.clip();
		if (settings.fit === "stretch") ctx.drawImage(bitmap, x, y, w, h);
		else {
			const ratio =
				settings.fit === "contain"
					? Math.min(w / bitmap.width, h / bitmap.height)
					: Math.max(w / bitmap.width, h / bitmap.height);
			ctx.drawImage(
				bitmap,
				x + (w - bitmap.width * ratio) / 2,
				y + (h - bitmap.height * ratio) / 2,
				bitmap.width * ratio,
				bitmap.height * ratio,
			);
		}
		ctx.restore();
		return imagePixels(canvas, width, height);
	} finally {
		bitmap.close();
	}
}

export function hexGeometry(settings, p, width, height, seed) {
	const [left, top, rw, rh] = settings.rect.map(
		(v, i) => v * (i % 2 === 0 ? width : height),
	);
	const short = Math.min(rw, rh),
		radius = settings.size * short,
		h = (Math.sqrt(3) * radius) / 2;
	const envelope = Math.sin(Math.PI * p) ** 2,
		theta = Math.PI * 2 * settings.cycles * p;
	const shrink = 1 - settings.gap * envelope,
		center = [left + rw / 2, top + rh / 2],
		faces = [];
	const rows = Math.floor((rh / radius + 1) / 1.5) + 1;
	for (let row = 0; row < rows; row++) {
		const odd = row % 2,
			firstColumn = -odd,
			lastColumn = Math.floor(rw / (2 * h) + 0.5 - odd * 0.5);
		for (let column = firstColumn; column <= lastColumn; column++) {
			const index = faces.length;
			const phases = [0, 1, 2].map(
				(i) => Math.PI * 2 * random(seed, index * 3 + i),
			);
			const z =
				short *
				settings.lift *
				envelope *
				(0.625 + 0.375 * Math.sin(theta + phases[0]));
			const rx = settings.tilt * envelope * Math.sin(theta + phases[1]),
				ry = settings.tilt * envelope * Math.cos(theta + phases[2]);
			const rotate = ([x, y, z]) => {
				const afterX = [
					x,
					y * Math.cos(rx) - z * Math.sin(rx),
					y * Math.sin(rx) + z * Math.cos(rx),
				];
				return [
					afterX[0] * Math.cos(ry) + afterX[2] * Math.sin(ry),
					afterX[1],
					-afterX[0] * Math.sin(ry) + afterX[2] * Math.cos(ry),
				];
			};
			const normal = rotate([0, 0, 1]),
				dot = Math.max(
					0,
					Math.min(
						1,
						(-0.35 * normal[0] - 0.45 * normal[1] + normal[2]) /
							Math.sqrt(1.325),
					),
				);
			const brightness = 1 - 0.75 * settings.shading * envelope * (1 - dot);
			const vertices = corners.map(([dx, dy]) => {
				const source = [
					left + h * (2 * column + odd + dx),
					top + (radius / 2) * (3 * row + dy),
				];
				const original = [h * dx, (radius / 2) * dy],
					rotated = rotate([original[0] * shrink, original[1] * shrink, 0]);
				const world = [
						source[0] + rotated[0] - original[0],
						source[1] + rotated[1] - original[1],
					],
					w = 1 - (settings.perspective * (z + rotated[2])) / (4 * short);
				return {
					position: world.map(
						(v, axis) => center[axis] + (v - center[axis]) / w,
					),
					uv: [source[0] / width, source[1] / height],
					w,
				};
			});
			faces.push({ vertices, brightness, opacity: settings.opacity, depth: z });
		}
	}
	return faces.sort((a, b) => a.depth - b.depth);
}

async function sampleHex(image, settings, frame, width, height, seed = 19) {
	const p = Math.max(0, Math.min(1, frame / 24)),
		pixels = await texture(image, settings, width, height);
	if (
		p === 0 ||
		p === 1 ||
		(settings.lift === 0 &&
			settings.tilt === 0 &&
			settings.gap === 0 &&
			settings.shading === 0)
	) {
		for (let i = 3; i < pixels.length; i += 4) pixels[i] *= settings.opacity;
		return { pixels, mask: new Uint8Array(width * height).fill(1) };
	}
	return rasterMesh({
		faces: hexGeometry(settings, p, width, height, seed),
		texture: pixels,
		width,
		height,
	});
}

function changed(a, b, mask) {
	let pixels = 0;
	for (let i = 0; i < a.length; i += 4)
		if (
			(!mask || mask[i / 4]) &&
			[0, 1, 2].some(
				(c) =>
					Math.abs((a[i + c] * a[i + 3]) / 255 - (b[i + c] * b[i + 3]) / 255) >
					3,
			)
		)
			pixels++;
	return pixels;
}

export async function checkHexScenes({ capture, resources, images }) {
	const width = 192,
		height = 108,
		settings = baseSettings(),
		source = sceneSource(resources, scene(settings));
	const snapshots = [],
		comparisons = [];
	const compare = async (label, controls, frame = 12, strict = false) => {
		const active = sceneSource(resources, scene(controls)),
			actual = await capture(active, frame);
		const expected = await sampleHex(images.a, controls, frame, width, height);
		comparisons.push(
			comparePixels(actual.pixels, expected.pixels, {
				label,
				mask: expected.mask,
				maxPremul: strict ? 2 : 5,
				maxAlpha: strict ? 2 : 4,
				meanPremul: strict ? 0.35 : 1,
				minPixels: width * height * 0.2,
			}),
		);
		snapshots.push(
			{ label, width, height, pixels: actual.pixels },
			{ label: `${label} CPU`, width, height, pixels: expected.pixels },
		);
		return { actual, expected, source: active };
	};
	await compare("Hex initial image", settings, 0, true);
	await compare("Hex final image", settings, 24, true);
	const neutral = {
		...settings,
		lift: 0,
		tilt: 0,
		gap: 0,
		shading: 0,
		opacity: 1,
	};
	const neutralCapture = await compare(
		"Hex neutral midpoint no seams",
		neutral,
		12,
		true,
	);
	await compare(
		"Hex neutral half alpha",
		{ ...neutral, opacity: 0.5 },
		12,
		true,
	);
	for (const fit of ["contain", "cover"])
		await compare(
			`Hex neutral ${fit} subrect`,
			{ ...neutral, fit, rect: [0.125, 0.2, 0.75, 0.5] },
			12,
			true,
		);
	const middle = await compare("Hex floating UV/normal/alpha", settings);
	const hashes = new Map([[12, middle.actual.hash]]);
	for (const frame of [6, 18, 0, 24, 12]) {
		const output = await capture(source, frame);
		if (hashes.has(frame))
			assert(hashes.get(frame) === output.hash, `Hex repeated frame ${frame}`);
		else hashes.set(frame, output.hash);
	}
	assert(
		hashes.get(6) !== hashes.get(18) && hashes.get(12) !== hashes.get(0),
		"Hex motion is static",
	);
	assert(
		(await capture({ ...source, seed: 97 }, 12)).hash !== middle.actual.hash,
		"Hex seed has no raster effect",
	);
	assert(
		(
			await capture(
				{ ...source, frameRate: { numerator: 30000, denominator: 1001 } },
				12,
			)
		).hash === middle.actual.hash,
		"Hex rational fps changed source frame",
	);
	assert(
		(await capture(source, 0, { trim: 48000 })).hash === middle.actual.hash,
		"Hex trim mapping",
	);
	assert(
		(await capture(JSON.parse(JSON.stringify(source)), 12)).hash ===
			middle.actual.hash,
		"Hex restored source",
	);
	const reverse = {
		...source,
		recipe: {
			...source.recipe,
			root: "reverse",
			nodes: [
				...source.recipe.nodes,
				{
					id: "reverse",
					scene: {
						kind: "ref",
						input: source.recipe.root,
						timeMap: [
							{ atFrame: 0, sourceFrame: 24 },
							{ atFrame: 24, sourceFrame: 0 },
						],
					},
				},
			],
		},
	};
	assert(
		(await capture(reverse, 12)).hash === middle.actual.hash,
		"Hex reverse ref midpoint",
	);
	assert(
		(await capture(reverse, 0)).hash === hashes.get(24),
		"Hex reverse ref endpoint",
	);
	const zero = await capture(
		sceneSource(resources, scene({ ...settings, opacity: 0 })),
		12,
	);
	assert(
		zero.pixels.every((v, i) => i % 4 !== 3 || v === 0),
		"Hex zero opacity filled pixels",
	);
	const hidden = await capture(
		{ ...source, recipe: { ...source.recipe, outputRoles: ["background"] } },
		12,
	);
	assert(
		hidden.pixels.every((v, i) => i % 4 !== 3 || v === 0),
		"Hex output role filtering",
	);
	const alpha = neutralCapture.actual.pixels;
	const transparent = Array.from(
		{ length: width * height },
		(_, i) => alpha[i * 4 + 3],
	).filter((v) => v === 0).length;
	const partial = Array.from(
		{ length: width * height },
		(_, i) => alpha[i * 4 + 3],
	).filter((v) => v > 0 && v < 255).length;
	assert(
		transparent > 500 && partial > 500,
		"Hex image did not exercise source holes and fractional alpha",
	);
	const depthSettings = {
		...settings,
		lift: 1,
		tilt: 0.35,
		gap: 0,
		cycles: 0.75,
		perspective: 0.8,
	};
	const depth = await compare("Hex far-to-near overlap", depthSettings);
	const depthFaces = hexGeometry(depthSettings, 0.5, width, height, 19);
	const wrongDepth = rasterMesh({
		faces: [...depthFaces].reverse(),
		texture: await texture(images.a, depthSettings, width, height),
		width,
		height,
	});
	const depthSensitive = changed(
		depth.expected.pixels,
		wrongDepth.pixels,
		depth.expected.mask,
	);
	assert(
		depthSensitive > 10,
		"Hex depth fixture did not distinguish reversed draw order",
	);
	const projectionSettings = {
		...settings,
		size: 0.4,
		lift: 0.4,
		tilt: 1.2,
		gap: 0.08,
		perspective: 0.8,
	};
	const projection = await compare(
		"Hex perspective-correct UV",
		projectionSettings,
	);
	const projectionFaces = hexGeometry(
		projectionSettings,
		0.5,
		width,
		height,
		19,
	);
	const affine = rasterMesh({
		faces: projectionFaces.map((face) => ({
			...face,
			vertices: face.vertices.map((vertex) => ({ ...vertex, w: 1 })),
		})),
		texture: await texture(images.a, projectionSettings, width, height),
		width,
		height,
	});
	const perspectiveSensitive = changed(
		projection.expected.pixels,
		affine.pixels,
		projection.expected.mask,
	);
	assert(
		perspectiveSensitive > 20,
		"Hex projection fixture did not distinguish affine UV interpolation",
	);
	return {
		evidence: {
			comparisons,
			transparent,
			partial,
			depthSensitive,
			perspectiveSensitive,
			frameHashes: Object.fromEntries(hashes),
			neutralMidpointUsesFullImageOracle: true,
		},
		snapshots,
		exports: [
			{
				name: "hex-float",
				source,
				oracle: (frame, w, h) => sampleHex(images.a, settings, frame, w, h),
			},
		],
	};
}

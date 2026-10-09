import {
	assert,
	comparePixels,
	freshMeshImage,
	imagePixels,
	sceneSource,
} from "./mesh-scenes-support.mjs";
import { rasterMesh } from "./mesh-scenes-mesh-oracle.mjs";

const corners = [
	[0, 0],
	[1, 0],
	[1, 1],
	[0, 1],
];
const controls = () => ({
	image: "mesh-a.png",
	rect: [0, 0, 1, 1],
	fit: "stretch",
	columns: 5,
	rows: 3,
	center: [0.35, 0.65],
	wavelength: 0.7,
	cycles: 1.25,
	lift: 0.38,
	tilt: 38,
	gap: 0.12,
	perspective: 0.8,
	shading: 0.65,
	opacity: 0.72,
});
const scene = (settings, extra = {}) => ({
	kind: "grid",
	role: "foreground",
	settings,
	span: { startFrame: 0, durationFrames: 24 },
	easing: "linear",
	...extra,
});

function phase(seed) {
	let value = (seed ^ Math.imul(0x6d2b79f5, 374761393)) >>> 0;
	value = Math.imul(value ^ (value >>> 13), 1274126177) >>> 0;
	return (((value ^ (value >>> 16)) >>> 0) / 4294967296) * 2 * Math.PI;
}

async function texture(image, settings, width, height) {
	const bitmap = await freshMeshImage(image);
	try {
		const canvas = new OffscreenCanvas(width, height),
			ctx = canvas.getContext("2d");
		const [x, y, w, h] = settings.rect.map(
			(v, i) => v * (i % 2 === 0 ? width : height),
		);
		ctx.beginPath();
		ctx.rect(x, y, w, h);
		ctx.clip();
		const scale =
			settings.fit === "contain"
				? Math.min(w / bitmap.width, h / bitmap.height)
				: Math.max(w / bitmap.width, h / bitmap.height);
		if (settings.fit === "stretch") ctx.drawImage(bitmap, x, y, w, h);
		else
			ctx.drawImage(
				bitmap,
				x + (w - bitmap.width * scale) / 2,
				y + (h - bitmap.height * scale) / 2,
				bitmap.width * scale,
				bitmap.height * scale,
			);
		return imagePixels(canvas, width, height);
	} finally {
		bitmap.close();
	}
}

// Geometry comes from the scene's documented radial wave, not a Worker/WASM plan.
function gridGeometry(settings, p, width, height, seed) {
	const [left, top, rw, rh] = settings.rect.map(
		(v, i) => v * (i % 2 === 0 ? width : height),
	);
	const short = Math.min(rw, rh),
		camera = 2 * Math.max(rw, rh);
	const tile = [rw / settings.columns, rh / settings.rows];
	const optical = [left + rw / 2, top + rh / 2];
	const origin = [
		left + rw * settings.center[0],
		top + rh * settings.center[1],
	];
	const envelope = Math.sin(Math.PI * p),
		shrink = 1 - settings.gap * envelope;
	const faces = [];
	for (let row = 0; row < settings.rows; row++)
		for (let column = 0; column < settings.columns; column++) {
			const center = [
				left + (column + 0.5) * tile[0],
				top + (row + 0.5) * tile[1],
			];
			const dx = center[0] - origin[0],
				dy = center[1] - origin[1],
				radius = Math.hypot(dx, dy);
			const wave =
				2 *
					Math.PI *
					(radius / short / settings.wavelength - settings.cycles * p) +
				phase(seed);
			const depth = settings.lift * short * envelope * Math.sin(wave);
			const tilt =
				((settings.tilt * Math.PI) / 180) * envelope * Math.cos(wave);
			const rx = radius ? (tilt * dy) / radius : 0,
				ry = radius ? (-tilt * dx) / radius : 0;
			const rotate = ([x, y]) => {
				const yaw = [x * Math.cos(ry), y, -x * Math.sin(ry)];
				return [
					yaw[0],
					yaw[1] * Math.cos(rx) - yaw[2] * Math.sin(rx),
					yaw[1] * Math.sin(rx) + yaw[2] * Math.cos(rx),
				];
			};
			const vertices = corners.map(([u, v]) => {
				const rotated = rotate([
					(u - 0.5) * tile[0] * shrink,
					(v - 0.5) * tile[1] * shrink,
				]);
				const w = 1 - (settings.perspective * (depth + rotated[2])) / camera;
				return {
					position: [0, 1].map(
						(axis) =>
							optical[axis] +
							(center[axis] + rotated[axis] - optical[axis]) / w,
					),
					uv: [
						(left + (column + u) * tile[0]) / width,
						(top + (row + v) * tile[1]) / height,
					],
					w,
				};
			});
			faces.push({
				vertices,
				depth,
				brightness: 1 - settings.shading * (1 - Math.cos(rx) * Math.cos(ry)),
				opacity: settings.opacity,
			});
		}
	return faces.sort((a, b) => a.depth - b.depth);
}

async function sampleGrid(
	image,
	settings,
	frame,
	width,
	height,
	seed = 19,
	span = { startFrame: 0, durationFrames: 24 },
	easing = "linear",
) {
	const raw = Math.max(
		0,
		Math.min(1, (frame - span.startFrame) / span.durationFrames),
	);
	const p = easing === "inQuad" ? raw * raw : raw;
	const pixels = await texture(image, settings, width, height);
	if (
		p === 0 ||
		p === 1 ||
		(settings.lift === 0 && settings.tilt === 0 && settings.gap === 0)
	) {
		for (let i = 3; i < pixels.length; i += 4) pixels[i] *= settings.opacity;
		if (p > 0 && p < 1) {
			// Neutral tiles still have hard mesh coverage at the outer rect. The
			// fitted Canvas texture may contain antialiased texels outside it.
			const [left, top, rw, rh] = settings.rect.map(
				(value, axis) => value * (axis % 2 === 0 ? width : height),
			);
			for (let y = 0; y < height; y++)
				for (let x = 0; x < width; x++)
					if (
						x + 0.5 < left ||
						x + 0.5 >= left + rw ||
						y + 0.5 < top ||
						y + 0.5 >= top + rh
					)
						pixels.fill(0, (y * width + x) * 4, (y * width + x + 1) * 4);
		}
		return { pixels, mask: new Uint8Array(width * height).fill(1) };
	}
	return rasterMesh({
		faces: gridGeometry(settings, p, width, height, seed),
		texture: pixels,
		width,
		height,
	});
}

function changed(a, b, mask) {
	let count = 0;
	for (let i = 0; i < a.length; i += 4)
		if (
			(!mask || mask[i / 4]) &&
			[0, 1, 2].some(
				(c) =>
					Math.abs((a[i + c] * a[i + 3]) / 255 - (b[i + c] * b[i + 3]) / 255) >
					3,
			)
		)
			count++;
	return count;
}

export async function checkGridScenes({ capture, resources, images }) {
	const width = 192,
		height = 108,
		settings = controls();
	const source = sceneSource(resources, scene(settings)),
		comparisons = [],
		snapshots = [];
	const compare = async (
		label,
		activeSettings,
		frame = 12,
		{ strict = false, seed = 19, extra = {} } = {},
	) => {
		const activeScene = scene(activeSettings, extra);
		const active = sceneSource(resources, activeScene, { seed }),
			actual = await capture(active, frame);
		const expected = await sampleGrid(
			images.a,
			activeSettings,
			frame,
			width,
			height,
			seed,
			activeScene.span,
			activeScene.easing,
		);
		comparisons.push(
			comparePixels(actual.pixels, expected.pixels, {
				label,
				mask: expected.mask,
				maxPremul: strict ? 2 : 5,
				maxAlpha: strict ? 2 : 4,
				meanPremul: strict ? 0.35 : 1,
				minPixels: width * height * 0.25,
			}),
		);
		snapshots.push(
			{ label, width, height, pixels: actual.pixels },
			{ label: `${label} CPU`, width, height, pixels: expected.pixels },
		);
		return { actual, expected, source: active };
	};
	await compare("Grid initial full image", settings, 0, { strict: true });
	await compare("Grid final full image", settings, 24, { strict: true });
	const neutral = { ...settings, lift: 0, tilt: 0, gap: 0, opacity: 1 };
	const neutralResult = await compare(
		"Grid neutral midpoint no seams",
		neutral,
		12,
		{ strict: true },
	);
	await compare("Grid opacity applied once", { ...neutral, opacity: 0.5 }, 12, {
		strict: true,
	});
	for (const fit of ["contain", "cover", "stretch"]) {
		await compare(
			`Grid ${fit} subrect full-frame UV`,
			{ ...neutral, fit, rect: [0.125, 0.2, 0.75, 0.5] },
			12,
			{ strict: true },
		);
		await compare(`Grid projected ${fit} subrect`, {
			...settings,
			fit,
			rect: [0.125, 0.2, 0.75, 0.5],
		});
	}
	await compare("Grid projected off-frame UV transparent", {
		...settings,
		rect: [-0.1, -0.15, 1.3, 1.4],
	});
	const middle = await compare("Grid radial wave UV/alpha/shading", settings);
	await compare("Grid degree tilt maximum", { ...settings, tilt: 60 });
	await compare("Grid all projection controls maximum", {
		...settings,
		lift: 1,
		tilt: 60,
		perspective: 1,
	});
	await compare("Grid eased source-frame span", settings, 10, {
		extra: {
			span: { startFrame: 4, durationFrames: 24 },
			easing: "inQuad",
		},
	});

	const variants = [
		["center", { center: [0.8, 0.2] }],
		["wavelength", { wavelength: 1.3 }],
		["cycles", { cycles: 2.1 }],
		["lift", { lift: 0 }],
		["tilt", { tilt: 0 }],
		["gap", { gap: 0.4 }],
		["perspective", { perspective: 0 }],
		["shading", { shading: 0 }],
		["density", { columns: 4, rows: 5 }],
	];
	const controlSensitivity = {};
	for (const [name, override] of variants) {
		const result = await compare(`Grid ${name} control`, {
			...settings,
			...override,
		});
		const count = changed(middle.expected.pixels, result.expected.pixels);
		assert(
			count > 20 && result.actual.hash !== middle.actual.hash,
			`Grid ${name} control has no effect`,
		);
		controlSensitivity[name] = count;
	}
	const hashes = new Map([[12, middle.actual.hash]]);
	for (const frame of [6, 18, 0, 24, 12, 6]) {
		const output = await capture(source, frame);
		if (hashes.has(frame))
			assert(
				hashes.get(frame) === output.hash,
				`Grid repeated source frame ${frame}`,
			);
		else hashes.set(frame, output.hash);
	}
	assert(
		hashes.get(6) !== hashes.get(18) && hashes.get(12) !== hashes.get(0),
		"Grid wave is static",
	);
	const seeded = await compare("Grid seed phase", settings, 12, { seed: 27 });
	assert(
		seeded.actual.hash !== middle.actual.hash,
		"Grid seed has no raster effect",
	);
	assert(
		(
			await capture(
				{ ...source, frameRate: { numerator: 30000, denominator: 1001 } },
				12,
			)
		).hash === middle.actual.hash,
		"Grid rational fps changed source frame",
	);
	assert(
		(await capture(source, 0, { trim: 48000 })).hash === middle.actual.hash,
		"Grid trim source-frame mapping",
	);
	assert(
		(await capture(JSON.parse(JSON.stringify(source)), 12)).hash ===
			middle.actual.hash,
		"Grid restored source",
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
		(await capture(reverse, 6)).hash === hashes.get(18),
		"Grid reverse ref moving frame",
	);
	assert(
		(await capture(reverse, 24)).hash === hashes.get(0),
		"Grid reverse ref endpoint",
	);
	for (const [label, active] of [
		[
			"zero opacity",
			sceneSource(resources, scene({ ...settings, opacity: 0 })),
		],
		[
			"filtered role",
			{ ...source, recipe: { ...source.recipe, outputRoles: ["background"] } },
		],
	]) {
		const result = await capture(active, 12);
		assert(
			result.pixels.every((v, i) => i % 4 !== 3 || v === 0),
			`Grid ${label} filled pixels`,
		);
	}
	const alpha = neutralResult.actual.pixels,
		alphaCounts = { transparent: 0, partial: 0 };
	for (let i = 3; i < alpha.length; i += 4) {
		if (alpha[i] === 0) alphaCounts.transparent++;
		else if (alpha[i] < 255) alphaCounts.partial++;
	}
	assert(
		alphaCounts.transparent > 500 && alphaCounts.partial > 500,
		"Grid source holes/fractional alpha missing",
	);

	const depthSettings = {
		...settings,
		columns: 4,
		rows: 3,
		lift: 1,
		tilt: 22,
		gap: 0,
		perspective: 1,
	};
	const depth = await compare("Grid far-to-near overlap", depthSettings);
	const faces = gridGeometry(depthSettings, 0.5, width, height, 19);
	const reversed = rasterMesh({
		faces: [...faces].reverse(),
		texture: await texture(images.a, depthSettings, width, height),
		width,
		height,
	});
	const depthSensitive = changed(
		depth.expected.pixels,
		reversed.pixels,
		depth.expected.mask,
	);
	assert(
		depthSensitive > 10,
		"Grid depth fixture did not distinguish reversed draw order",
	);

	const projectionSettings = {
		...settings,
		columns: 3,
		rows: 2,
		lift: 0.5,
		tilt: 60,
		gap: 0.15,
		perspective: 1,
	};
	const projection = await compare(
		"Grid perspective-correct UV",
		projectionSettings,
	);
	const projected = gridGeometry(projectionSettings, 0.5, width, height, 19);
	const affine = rasterMesh({
		faces: projected.map((face) => ({
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
		"Grid fixture did not distinguish affine UV interpolation",
	);

	const gapSettings = { ...neutral, gap: 0.4 },
		gap = await compare("Grid gaps preserve complete tile UV", gapSettings);
	const gapFaces = gridGeometry(gapSettings, 0.5, width, height, 19);
	const croppedFaces = gapFaces.map((face) => {
		const center = face.vertices.reduce(
			(sum, v) => sum.map((value, axis) => value + v.uv[axis] / 4),
			[0, 0],
		);
		return {
			...face,
			vertices: face.vertices.map((v) => ({
				...v,
				uv: v.uv.map(
					(value, axis) =>
						center[axis] + (value - center[axis]) * (1 - gapSettings.gap),
				),
			})),
		};
	});
	const cropped = rasterMesh({
		faces: croppedFaces,
		texture: await texture(images.a, gapSettings, width, height),
		width,
		height,
	});
	const completeUvSensitive = changed(
		gap.expected.pixels,
		cropped.pixels,
		gap.expected.mask,
	);
	assert(
		completeUvSensitive > 100,
		"Grid gap fixture did not distinguish UV cropping",
	);
	return {
		evidence: {
			comparisons,
			...alphaCounts,
			controlSensitivity,
			depthSensitive,
			perspectiveSensitive,
			completeUvSensitive,
			frameHashes: Object.fromEntries(hashes),
			neutralMidpointUsesFullImageOracle: true,
		},
		snapshots,
		exports: [
			{
				name: "grid",
				source,
				oracle: (frame, w, h) => sampleGrid(images.a, settings, frame, w, h),
			},
		],
	};
}

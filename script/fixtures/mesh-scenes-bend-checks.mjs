import {
	assert,
	comparePixels,
	imagePixels,
	over,
	sampleRgba,
	transitionSource,
} from "./mesh-scenes-support.mjs";

export const bendStyle = (direction = "left") => ({
	kind: "bend",
	direction,
	hinge: 0.5,
	angle: Math.PI,
	perspective: 0.5,
	shading: 0.6,
});

function axis(x, y, width, height, direction) {
	if (direction === "right") return [1 - x / width, y / height];
	if (direction === "up") return [y / height, x / width];
	if (direction === "down") return [1 - y / height, x / width];
	return [x / width, y / height];
}
function sourceUv(u, v, direction) {
	if (direction === "right") return [1 - u, v];
	if (direction === "up") return [v, u];
	if (direction === "down") return [v, 1 - u];
	return [u, v];
}

// Solve the camera ray / rigid plane intersection. No production plan or vertices are read.
export function inverseBendPoint(x, y, width, height, progress, style) {
	const [q, r] = axis(x, y, width, height, style.direction);
	const hinge =
		progress <= 0.5
			? 1 - 2 * progress * (1 - style.hinge)
			: 2 * style.hinge * (1 - progress);
	const theta = style.angle * progress,
		sine = Math.sin(theta),
		cosine = Math.cos(theta);
	const denominator = cosine + style.perspective * sine * (q - 0.5);
	const distance =
		Math.abs(denominator) < 1e-12 ? Infinity : (q - hinge) / denominator;
	const divisor = 1 - style.perspective * sine * distance;
	const v = 0.5 + (r - 0.5) * divisor;
	const hit =
		Number.isFinite(distance) &&
		distance >= 0 &&
		distance <= 1 - hinge &&
		divisor >= 0.2 - 1e-12 &&
		v >= 0 &&
		v <= 1;
	return {
		q,
		hinge,
		hit,
		uv: sourceUv(hinge + distance, v, style.direction),
		brightness: 1 - (style.shading * (1 - cosine)) / 2,
	};
}

export function bendOracle(
	images,
	frame,
	width,
	height,
	style = bendStyle(),
	duration = 24,
) {
	const a = imagePixels(images.a, width, height),
		b = imagePixels(images.b, width, height);
	const p = Math.max(0, Math.min(1, frame / duration));
	const mask = new Uint8Array(width * height).fill(1);
	if (p === 0 || p === 1) return { pixels: p === 0 ? a : b, mask };
	const pixels = new Uint8ClampedArray(a.length),
		counts = { mesh: 0, flatA: 0, baseB: 0, partial: 0, clear: 0 };
	const axisPixels =
		style.direction === "up" || style.direction === "down" ? height : width;
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const index = (y * width + x) * 4;
			const hit = inverseBendPoint(x + 0.5, y + 0.5, width, height, p, style);
			const base = hit.q < hit.hinge ? a : b;
			counts[hit.q < hit.hinge ? "flatA" : "baseB"]++;
			let color = [...base.subarray(index, index + 4)];
			if (hit.hit) {
				counts.mesh++;
				const top = sampleRgba(a, width, height, ...hit.uv);
				for (let c = 0; c < 3; c++) top[c] *= hit.brightness;
				color = over(top, color);
			}
			pixels.set(color, index);
			if (pixels[index + 3] === 0) counts.clear++;
			else if (pixels[index + 3] < 255) counts.partial++;
			// Only coverage boundaries are excluded; interior UVs and the fan diagonal remain tested.
			if (
				Math.abs(hit.q - hit.hinge) * axisPixels < 1.5 ||
				[
					[-1.5, 0],
					[1.5, 0],
					[0, -1.5],
					[0, 1.5],
				].some(
					([dx, dy]) =>
						inverseBendPoint(
							x + 0.5 + dx,
							y + 0.5 + dy,
							width,
							height,
							p,
							style,
						).hit !== hit.hit,
				)
			)
				mask[index / 4] = 0;
		}
	return { pixels, mask, counts };
}

export async function checkBendScenes({ capture, resources, images }) {
	const snapshots = [],
		comparisons = [],
		temporal = {},
		width = 192,
		height = 108;
	const directions = ["left", "right", "up", "down"],
		directionHashes = [];
	for (const direction of directions) {
		const style = bendStyle(direction),
			source = transitionSource(resources, style);
		const hashes = {};
		for (const frame of [0, 6, 12, 18, 24]) {
			const actual = await capture(source, frame),
				expected = bendOracle(images, frame, width, height, style);
			hashes[frame] = actual.hash;
			comparisons.push(
				comparePixels(actual.pixels, expected.pixels, {
					label: `Bend ${direction} ${frame}`,
					mask: expected.mask,
					maxPremul: 5,
					maxAlpha: 3,
					meanPremul: 1.2,
					minPixels: width * height * 0.75,
				}),
			);
			if (frame === 6 || frame === 18) {
				assert(
					expected.counts.mesh > 500 &&
						expected.counts.partial > 500 &&
						expected.counts.clear > 100,
					`Bend ${direction} ${frame}: insufficient UV/alpha coverage`,
				);
			}
			snapshots.push({
				label: `bend-${direction}-${frame}`,
				width,
				height,
				pixels: actual.pixels,
			});
		}
		assert(
			new Set(Object.values(hashes)).size === 5,
			`Bend ${direction}: poses did not vary`,
		);
		for (const frame of [24, 0, 18, 6, 12])
			assert(
				(await capture(source, frame)).hash === hashes[frame],
				`Bend ${direction}: history leak`,
			);
		directionHashes.push(hashes[6]);
		temporal[direction] = hashes;
	}
	assert(
		new Set(directionHashes).size === 4,
		"Bend directions produced identical pixels",
	);
	const source = transitionSource(resources, bendStyle());
	const original = temporal.left[6];
	for (const change of [
		{ angle: Math.PI / 2 },
		{ hinge: 0.35 },
		{ perspective: 0 },
		{ shading: 0 },
	]) {
		const style = { ...bendStyle(), ...change },
			changed = transitionSource(resources, style);
		const actual = await capture(changed, 6),
			expected = bendOracle(images, 6, width, height, style);
		assert(actual.hash !== original, `Bend ignored ${Object.keys(change)}`);
		comparisons.push(
			comparePixels(actual.pixels, expected.pixels, {
				label: `Bend ${Object.keys(change)}`,
				mask: expected.mask,
				maxPremul: 5,
				maxAlpha: 3,
				meanPremul: 1.2,
				minPixels: width * height * 0.75,
			}),
		);
	}
	assert(
		(await capture(source, 0, { trim: 24000 })).hash === original,
		"Bend source trim mapping",
	);
	assert(
		(
			await capture(
				{ ...source, frameRate: { numerator: 30000, denominator: 1001 } },
				6,
			)
		).hash === original,
		"Bend rational frame mapping",
	);
	assert(
		(await capture(JSON.parse(JSON.stringify(source)), 6)).hash === original,
		"Bend JSON reopen",
	);
	const reversed = structuredClone(source);
	reversed.recipe.root = "reverse";
	reversed.recipe.nodes.push({
		id: "reverse",
		scene: {
			kind: "ref",
			input: "mix",
			timeMap: [
				{ atFrame: 0, sourceFrame: 24 },
				{ atFrame: 24, sourceFrame: 0 },
			],
		},
	});
	for (const frame of [0, 6, 12, 18, 24])
		assert(
			(await capture(reversed, frame)).hash === temporal.left[24 - frame],
			"Bend reverse ref",
		);
	const hidden = structuredClone(source);
	hidden.recipe.outputRoles = ["background"];
	assert(
		(await capture(hidden, 6)).pixels.every((v, i) => i % 4 !== 3 || v === 0),
		"Bend output-role filtering",
	);
	let rejected = false;
	try {
		await capture(source, 6, { resources: [] });
	} catch {
		rejected = true;
	}
	assert(rejected, "Bend accepted missing image attachments");

	// Opaque A/B eliminate texture ambiguity: every pixel must have exactly full coverage.
	for (const direction of directions) {
		const opaque = transitionSource(resources, {
			...bendStyle(direction),
			shading: 0,
		});
		for (const node of opaque.recipe.nodes)
			if (node.id !== "mix")
				node.scene = {
					kind: "solid",
					role: "foreground",
					color: node.id === "a" ? [1, 0, 0, 1] : [0, 0, 1, 1],
				};
		for (const frame of [6, 12, 18]) {
			const { pixels } = await capture(opaque, frame);
			assert(
				pixels.every((v, i) =>
					i % 4 === 3 ? v === 255 : v === 0 || v === 255,
				),
				`Bend ${direction} ${frame}: alpha cracks or duplicate triangle blend`,
			);
		}
	}
	const fractional = transitionSource(resources, {
		...bendStyle("left"),
		hinge: 0.37,
		angle: Math.PI,
		perspective: 0,
		shading: 0,
	});
	for (const node of fractional.recipe.nodes)
		if (node.id !== "mix")
			node.scene = {
				kind: "solid",
				role: "foreground",
				color: node.id === "a" ? [1, 0, 0, 1] : [0, 0, 1, 1],
			};
	const fractionalActual = await capture(fractional, 12);
	const fractionalExpected = new Uint8ClampedArray(width * height * 4);
	// At p=.5 the plane is edge-on at x=71.04. Pixel centers 0..70 select A,
	// 71..191 select B. Neither the shared edge nor any other pixel may be masked.
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++)
			fractionalExpected.set(
				x < 71 ? [255, 0, 0, 255] : [0, 0, 255, 255],
				(y * width + x) * 4,
			);
	comparisons.push(
		comparePixels(fractionalActual.pixels, fractionalExpected, {
			label: "Bend fractional edge-on hinge .37 / 192px",
			maxPremul: 0,
			maxAlpha: 0,
			meanPremul: 0,
			minPixels: width * height,
		}),
	);
	const thin = structuredClone(fractional);
	thin.recipe.nodes.find((node) => node.id === "mix").scene.style.angle =
		Math.PI - 1e-6;
	comparisons.push(
		comparePixels((await capture(thin, 12)).pixels, fractionalExpected, {
			label: "Bend near-edge-on finite texture projection",
			maxPremul: 0,
			maxAlpha: 0,
			meanPremul: 0,
			minPixels: width * height,
		}),
	);
	snapshots.push({
		label: "bend-edgeon-fractional-hinge",
		width,
		height,
		pixels: fractionalActual.pixels,
	});
	return {
		evidence: {
			comparisons,
			temporal,
			opaqueCrackFrames: 14,
			fractionalEdgeOn: {
				hinge: 0.37,
				pixelBoundary: 71.04,
				frame: 12,
				fullFrameExact: true,
			},
			oracle:
				"independent inverse ray/plane projection plus premultiplied source-image sampling",
			boundaries:
				"only 1.5px outer coverage/hinge boundaries excluded; internal diagonal included",
		},
		snapshots,
		exports: [
			{
				name: "bend",
				source,
				oracle: (frame, w, h) => bendOracle(images, frame, w, h),
			},
			{
				name: "bend-back",
				source: transitionSource(
					resources,
					bendStyle(),
					{},
					{ startFrame: 0, durationFrames: 12 },
				),
				oracle: (frame, w, h) =>
					bendOracle(images, frame, w, h, bendStyle(), 12),
			},
		],
	};
}

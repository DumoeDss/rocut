import type { MvSprite, ProgrammaticSource } from "@opencut/editor-contracts";
import {
	assertPost as assert,
	postAt as at,
	postCapture,
	postHash,
	postPixels,
	postResource,
	postSource,
} from "./mv-post-fixture";

export async function runMvSpriteProbe() {
	const checks: string[] = [];
	let captures = 0;
	const resource = await postResource("cutout.png", (c) => {
		c.fillStyle = "red";
		c.fillRect(24, 8, 16, 48);
		c.fillStyle = "lime";
		c.fillRect(24, 8, 4, 8);
	});
	const resources = [resource];
	const base = postSource(resources);
	const original = base.recipe!.nodes[0].scene;
	if (original.kind !== "illust") throw Error("Invalid sprite fixture");
	const source = (patch: Partial<MvSprite> = {}): ProgrammaticSource => ({
		...base,
		recipe: {
			...base.recipe!,
			songStartSeconds: 0,
			nodes: [
				{
					id: "shot",
					scene: {
						...original,
						sprites: [{ ...original.sprites![0], ...patch }],
					},
				},
			],
		},
	});
	const sheet = document.createElement("canvas");
	sheet.id = "mv-sprite-contact-sheet";
	sheet.width = 640;
	sheet.height = 4 * 152;
	document.body.append(sheet);
	const ctx = sheet.getContext("2d")!;
	ctx.fillStyle = "#182130";
	ctx.fillRect(0, 0, sheet.width, sheet.height);
	const label = (row: number, text: string) => {
		ctx.fillStyle = "white";
		ctx.font = "12px sans-serif";
		ctx.fillText(text, 4, row * 152 + 14);
	};
	const capture = async (
		s: ProgrammaticSource,
		f = 0,
		cell?: [number, number],
		assets = resources,
	) => {
		const image = await postCapture(s, assets, f);
		captures++;
		try {
			if (cell) {
				const [row, col] = cell,
					x = col * 128,
					y = row * 152 + 20;
				for (let a = 0; a < 128; a += 8)
					for (let b = 0; b < 128; b += 8) {
						ctx.fillStyle = (a + b) % 16 ? "#666" : "#aaa";
						ctx.fillRect(x + a, y + b, 8, 8);
					}
				const scale = 128 / Math.max(image.width, image.height);
				ctx.drawImage(image, x, y, image.width * scale, image.height * scale);
			}
			return postPixels(image, s.width, s.height);
		} finally {
			image.close();
		}
	};
	const shadow: MvSprite["shadow"] = {
		color: [0, 0, 1, 1],
		offset: [0.25, 0],
		blur: 0,
	};
	const rim: MvSprite["rim"] = {
		color: [1, 1, 0, 1],
		offset: [-0.125, 0],
		blur: 0,
	};
	const decorated = source({ shadow, rim });
	label(0, "base / shadow+rim / silhouette / soft rim / local glow");
	const plain = await capture(source(), 0, [0, 0]);
	const styled = await capture(decorated, 0, [0, 1]);
	assert(
		at(styled, 32, 32).join() === "255,0,0,255",
		"Body paint order changed",
	);
	assert(
		at(styled, 46, 32).join() === "0,0,255,255",
		"Shadow is not an offset alpha silhouette",
	);
	assert(at(styled, 20, 32).join() === "255,255,0,255", "Rim underlay missing");
	assert(at(styled, 2, 32)[3] === 0, "Effects filled the transparent frame");
	const sil = await capture(source({ silhouette: [0, 1, 0, 0.5] }), 0, [0, 2]);
	assert(
		at(sil, 32, 32)[1] === 255 &&
			Math.abs(at(sil, 32, 32)[3] - 128) <= 1 &&
			at(sil, 2, 32)[3] === 0,
		"Silhouette did not preserve alpha coverage",
	);
	const soft = await capture(
		source({ rim: { ...rim, offset: [0, 0], blur: 0.04 } }),
		0,
		[0, 3],
	);
	assert(
		at(soft, 21, 32)[3] > 0 && at(plain, 21, 32)[3] === 0,
		"Soft rim did not expand coverage",
	);
	const glow = await capture(
		source({ glow: { color: [0, 1, 1, 1], offset: [0.25, 0], radius: 0.2 } }),
		0,
		[0, 4],
	);
	assert(
		at(glow, 48, 32)[1] > 200 &&
			at(glow, 48, 32)[3] > 150 &&
			at(glow, 63, 32)[3] === 0,
		"Local glow center/radius incorrect",
	);
	checks.push(
		"independent alpha/color landmarks for ordered shadow, additive rim, silhouette, blur and local glow",
	);
	const enter: NonNullable<MvSprite["enter"]> = {
		span: { startFrame: 0, durationFrames: 4 },
		easing: "linear",
		offset: [0, 0],
		scale: 1,
		rotation: 0,
		opacity: 0,
	};
	const faded = source({
		shadow,
		rim,
		enter,
		exit: { ...enter, span: { startFrame: 16, durationFrames: 4 } },
	});
	label(1, "sprite group opacity: f0 / f2 / f4 / f18 / f20");
	for (const [col, f] of [0, 2, 4, 18, 20].entries()) {
		const bytes = await capture(faded, f, [1, col]);
		if (f === 0 || f === 20)
			assert(
				bytes.every((v) => v === 0),
				"Hidden sprite left decorative pixels",
			);
		else
			for (const x of [20, 32, 46])
				assert(
					Math.abs(at(bytes, x, 32)[3] - (f === 4 ? 255 : 128)) <= 1,
					"Group opacity applied separately to overlapping effects",
				);
	}
	const moving = source({
		enter: { ...enter, offset: [-0.25, 0], scale: 0.5 },
	});
	assert(
		at(await capture(moving, 2), 18, 32)[3] > 100 &&
			at(await capture(moving, 4), 18, 32)[3] === 0,
		"Entry offset/scale was not rendered",
	);
	const unselected = {
		...decorated,
		recipe: { ...decorated.recipe!, outputRoles: ["subject" as const] },
	};
	assert(
		(await capture(unselected)).every((v) => v === 0),
		"Sprite decoration escaped its semantic role",
	);
	const offscreen = source({
		from: { x: -0.5, y: 0.5, height: 1, rotation: 0, opacity: 1 },
		to: { x: -0.5, y: 0.5, height: 1, rotation: 0, opacity: 1 },
		shadow: { ...shadow, offset: [1, 0] },
	});
	assert(
		at(await capture(offscreen), 32, 32).join() === "0,0,255,255",
		"Frame-clipped body lost an onscreen shadow",
	);
	checks.push(
		"entry/exit offsets, scale, endpoints, unified fade, selected roles and offscreen shadow recovery",
	);
	const edgePose = { x: -9 / 64, y: 0.5, height: 1, rotation: 0, opacity: 1 };
	const edgeBlur = await capture(
		source({
			from: edgePose,
			to: edgePose,
			shadow: { ...shadow, offset: [0, 0], blur: 0.05 },
		}),
	);
	assert(
		at(edgeBlur, 0, 32)[2] === 255 && at(edgeBlur, 0, 32)[3] > 5,
		"Offscreen blur was clipped before filtering",
	);
	const wave: NonNullable<MvSprite["wave"]> = {
		amplitude: 0.25,
		from: 0,
		cycles: 0,
		frequency: 1,
		phase: Math.PI / 2,
		strips: 8,
	};
	const waving = source({ wave });
	label(2, "wave: f0 / f6 / f12 / flipped / translucent strips");
	const bent = await capture(waving, 0, [2, 0]),
		flat = await capture(waving, 6, [2, 1]);
	await capture(waving, 12, [2, 2]);
	assert(
		at(bent, 25, 52)[3] === 0 &&
			at(bent, 42, 52)[0] === 255 &&
			at(flat, 25, 52)[0] === 255,
		"Wave did not shift lower strips with sampled time",
	);
	assert(at(bent, 25, 12)[3] > 240, "Wave unexpectedly moved anchored top");
	const flipped = await capture(source({ flip: true }), 0, [2, 3]);
	assert(
		at(flipped, 38, 12).join() === "0,255,0,255" &&
			at(plain, 25, 12).join() === "0,255,0,255",
		"Sprite flip/anchor changed",
	);
	const translucent = await postResource("translucent.png", (c) => {
		c.fillStyle = "rgba(255,0,0,0.5)";
		c.fillRect(0, 0, 64, 64);
	});
	const transparentSource = {
		...waving,
		resources: [translucent.resource],
		recipe: {
			...waving.recipe!,
			nodes: [
				{
					id: "shot",
					scene: {
						...original,
						sprites: [
							{
								...original.sprites![0],
								image: "translucent.png",
								wave: { ...wave, amplitude: 0 },
							},
						],
					},
				},
			],
		},
	};
	const strips = await capture(transparentSource, 0, [2, 4], [translucent]);
	for (let y = 0; y < 64; y++)
		assert(
			Math.abs(at(strips, 32, y)[3] - 128) <= 1,
			`Strip seam changed alpha at row ${y}`,
		);
	const rotatePose = { ...original.sprites![0].from, rotation: 0.4 };
	const rotatedAlpha = source({
		image: "translucent.png",
		wave: { ...wave, amplitude: 0 },
		from: rotatePose,
		to: rotatePose,
	});
	const rotatedStrips = await capture(
		{ ...rotatedAlpha, resources: [translucent.resource] },
		0,
		undefined,
		[translucent],
	);
	for (let y = 16; y < 48; y++)
		for (let x = 16; x < 48; x++)
			assert(
				Math.abs(at(rotatedStrips, x, y)[3] - 128) <= 2,
				`Rotated strip coverage seam at ${x},${y}: ${at(rotatedStrips, x, y)[3]}`,
			);
	checks.push(
		"wave displacement landmarks, source alpha at every strip boundary and asymmetric flip/anchor",
	);
	const animated = source({
		wave: { ...wave, frequency: 0.7, cycles: 1 },
		shadow,
		rim,
		enter: { ...enter, span: { startFrame: 0, durationFrames: 8 } },
		drawingFps: 12,
	});
	assert(
		(await postHash(await capture(animated, 0))) ===
			(await postHash(await capture(animated, 1))),
		"Drawing sampling failed at first pair",
	);
	const sample = await capture(animated, 2);
	assert(
		(await postHash(sample)) === (await postHash(await capture(animated, 3))),
		"Wave and body use different drawing clocks",
	);
	await capture(animated, 14);
	assert(
		(await postHash(sample)) === (await postHash(await capture(animated, 2))),
		"Reverse seek changed decorated sprite",
	);
	const frozen = {
		...animated,
		recipe: {
			...animated.recipe!,
			root: "hold",
			nodes: [
				...animated.recipe!.nodes,
				{
					id: "hold",
					scene: {
						kind: "ref" as const,
						input: "shot",
						timeMap: [{ atFrame: 0, sourceFrame: 2 }],
					},
				},
			],
		},
	};
	assert(
		(await postHash(sample)) === (await postHash(await capture(frozen, 20))),
		"Reference did not freeze the complete styled sprite",
	);
	label(3, "decorated f4 / f16 / portrait / landscape / rotated");
	await capture(animated, 4, [3, 0]);
	await capture(animated, 16, [3, 1]);
	for (const [col, [width, height]] of [
		[48, 96],
		[96, 48],
	].entries()) {
		const sized = { ...animated, width, height },
			bytes = await capture(sized, 4, [3, col + 2]);
		assert(
			(await postHash(bytes)) === (await postHash(await capture(sized, 4))),
			"Non-square sprite seek was unstable",
		);
	}
	const rotated = source({
		wave,
		shadow,
		rim,
		from: { ...original.sprites![0].from, rotation: 0.4 },
		to: { ...original.sprites![0].to, rotation: 0.4 },
	});
	await capture(rotated, 0, [3, 4]);
	checks.push(
		"quantized complete sprite, freeze/reference and random seek, portrait/landscape and rotated rendering",
	);
	return { passed: true, checks, captures, source: animated, resources };
}

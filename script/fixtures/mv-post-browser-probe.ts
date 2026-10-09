import type {
	MvEffect,
	ProgrammaticSource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
import {
	assertPost as assert,
	postAt as at,
	postCapture,
	postHash,
	postPixels,
	postResource,
	postSource,
	spatialEffects,
} from "./mv-post-fixture";

export async function runMvPostProbe() {
	const checks: string[] = [];
	let captures = 0;
	const sheet = document.createElement("canvas");
	sheet.id = "mv-post-contact-sheet";
	sheet.width = 640;
	sheet.height = 7 * 152;
	const ctx = sheet.getContext("2d")!;
	ctx.fillStyle = "#151c2b";
	ctx.fillRect(0, 0, sheet.width, sheet.height);
	document.body.append(sheet);
	const texture = await postResource("texture.png", (c) => {
		for (let y = 8; y < 56; y += 4)
			for (let x = 8; x < 56; x += 4) {
				c.fillStyle = (x + y) % 8 ? "#23b6d2" : "#fbea91";
				c.fillRect(x, y, 4, 4);
			}
		c.fillStyle = "red";
		c.fillRect(8, 8, 8, 8);
	});
	const white = await postResource("white.png", (c) => {
		c.fillStyle = "white";
		c.fillRect(24, 24, 16, 16);
	});
	const red = await postResource("red.png", (c) => {
		c.fillStyle = "rgba(255,0,0,0.5)";
		c.fillRect(24, 24, 16, 16);
	});
	const capture = async (
		s: ProgrammaticSource,
		resources: ResolvedProgrammaticResource[],
		frame = 0,
		cell?: [number, number],
	) => {
		const image = await postCapture(s, resources, frame);
		captures++;
		try {
			if (cell) {
				const [row, col] = cell,
					x = col * 128,
					y = row * 152 + 20;
				for (let a = 0; a < 128; a += 8)
					for (let b = 0; b < 128; b += 8) {
						ctx.fillStyle = (a + b) % 16 ? "#555" : "#888";
						ctx.fillRect(x + a, y + b, 8, 8);
					}
				const scale = 128 / Math.max(image.width, image.height);
				const iw = image.width * scale,
					ih = image.height * scale;
				ctx.drawImage(image, x + (128 - iw) / 2, y + (128 - ih) / 2, iw, ih);
			}
			return postPixels(image, s.width, s.height);
		} finally {
			image.close();
		}
	};
	const label = (row: number, title: string) => {
		ctx.fillStyle = "white";
		ctx.font = "12px sans-serif";
		ctx.fillText(title, 4, row * 152 + 14);
	};
	const baseline = await capture(postSource([texture]), [texture]);
	const baseHash = await postHash(baseline);
	for (const [row, e] of spatialEffects.entries()) {
		label(row, `${e.kind}: baseline / f0 / f1 / f2 / f8`);
		await capture(postSource([texture]), [texture], 0, [row, 0]);
		const off = await capture(
			postSource([texture], [{ ...e, amount: 0 } as MvEffect]),
			[texture],
		);
		assert(
			(await postHash(off)) === baseHash,
			`${e.kind} zero amount not exact identity`,
		);
		const s = postSource([texture], [e]),
			hashes: string[] = [];
		for (const [col, f] of [0, 1, 2, 8, 0].entries()) {
			const d = await capture(
				s,
				[texture],
				f,
				col < 4 ? [row, col + 1] : undefined,
			);
			hashes.push(await postHash(d));
		}
		assert(hashes[0] !== baseHash, `${e.kind} did not alter actual pixels`);
		assert(hashes[0] === hashes[4], `${e.kind} reverse seek not reproducible`);
		if (e.kind === "glitch" || e.kind === "lineBoil") {
			assert(
				hashes[0] === hashes[1] && hashes[0] !== hashes[2],
				`${e.kind} independent 12fps clock failed`,
			);
			const changed = await capture({ ...s, seed: 99 }, [texture]);
			assert(
				(await postHash(changed)) !== hashes[0],
				`${e.kind} ignored source seed`,
			);
		}
	}
	checks.push(
		"all five spatial mechanisms alter textured pixels; exact zero identity, seed, integer 12fps holds and reverse seek",
	);
	const ca = await capture(postSource([white], [spatialEffects[2]]), [white]);
	assert(
		at(ca, 21, 32).join() === "255,0,0,255",
		`CA red fringe: ${at(ca, 21, 32)}`,
	);
	assert(
		at(ca, 42, 32).join() === "0,0,255,255",
		`CA blue fringe: ${at(ca, 42, 32)}`,
	);
	assert(at(ca, 0, 0)[3] === 0, "CA filled transparent corners");
	const oriented = await capture(
		postSource(
			[texture],
			[{ kind: "chromaticAberration", amount: 1, center: [0.1, 0.1] }],
		),
		[texture],
	);
	assert(
		at(oriented, 12, 12).join() === "255,0,0,255",
		"GPU upload/readback inverted the asymmetric top-left marker",
	);
	const zoom = await capture(postSource([red], [spatialEffects[3]]), [red]);
	const fringe = at(zoom, 44, 32);
	assert(
		fringe[0] >= 250 &&
			fringe[1] === 0 &&
			fringe[2] === 0 &&
			fringe[3] > 0 &&
			fringe[3] < 128,
		`Zoom premultiplied fringe darkened: ${fringe}`,
	);
	assert(
		Math.abs(at(zoom, 32, 32)[3] - 128) <= 1,
		"Zoom amplified alpha on constant region",
	);
	checks.push(
		"independent CA channel positions and zoom-blur semi-transparent saturated edges without black halos",
	);
	label(5, "bloom: input / preserve / expand / threshold=1 / blank");
	const bloom = spatialEffects[4] as Extract<MvEffect, { kind: "bloom" }>;
	await capture(postSource([red]), [red], 0, [5, 0]);
	const preserve = await capture(
		postSource([red], [{ ...bloom, alpha: "preserve" }]),
		[red],
		0,
		[5, 1],
	);
	const expand = await capture(postSource([red], [bloom]), [red], 0, [5, 2]);
	const raw = await capture(postSource([red]), [red]);
	for (let i = 3; i < raw.length; i += 4)
		assert(preserve[i] === raw[i], "Preserve bloom changed role alpha");
	assert(
		at(expand, 21, 32)[3] > 0 && at(expand, 21, 32)[0] >= 250,
		"Expand bloom lacks saturated glow outside source coverage",
	);
	const disabled = await capture(
		postSource([red], [{ ...bloom, threshold: 1 }]),
		[red],
		0,
		[5, 3],
	);
	assert(
		(await postHash(disabled)) === (await postHash(raw)),
		"Bloom emitted light above unit threshold",
	);
	const blank = await postResource("blank.png", () => {});
	const empty = await capture(postSource([blank], [bloom]), [blank], 0, [5, 4]);
	assert(
		empty.every((v) => v === 0),
		"Bloom made an empty role opaque",
	);
	const wide = await capture(postSource([red], [{ ...bloom, radius: 6 }]), [
		red,
	]);
	const coverage = (d: Uint8ClampedArray) =>
		d.filter((v, i) => i % 4 === 3 && v > 1).length;
	assert(
		coverage(wide) > coverage(expand),
		"Bloom radius did not increase halo footprint",
	);
	checks.push(
		"three-level bloom preserves selected alpha or explicitly expands glow; threshold and empty-layer behavior",
	);
	const palette: MvEffect = {
		kind: "palette",
		colors: [
			[1, 0, 0, 1],
			[1, 0, 0, 1],
		],
		mix: 1,
	};
	const first = await capture(
		postSource([white], [palette, spatialEffects[2]]),
		[white],
	);
	const last = await capture(
		postSource([white], [spatialEffects[2], palette]),
		[white],
	);
	assert(
		at(first, 42, 32).slice(0, 3).join() === "0,0,0",
		"Palette before CA order ignored",
	);
	assert(
		at(last, 42, 32).slice(0, 3).join() === "255,0,0",
		"Palette after CA order ignored",
	);
	const unselected = postSource([texture], spatialEffects);
	const isolated: ProgrammaticSource = {
		...unselected,
		recipe: {
			...unselected.recipe!,
			post: [{ roles: ["background"], effects: spatialEffects }],
		},
	};
	assert(
		(await postHash(await capture(isolated, [texture]))) === baseHash,
		"Post touched an unselected foreground role",
	);
	const scene = unselected.recipe!.nodes[0].scene;
	if (scene.kind !== "illust") throw Error("Invalid fixture scene");
	const combined: ProgrammaticSource = {
		...unselected,
		recipe: {
			...unselected.recipe!,
			outputRoles: ["foreground", "background"],
			nodes: [
				{
					id: "shot",
					scene: {
						...scene,
						background: {
							image: "texture.png",
							from: { x: 0, y: 0, zoom: 2 },
							to: { x: 0, y: 0, zoom: 2 },
						},
					},
				},
			],
			post: [{ roles: ["background"], effects: spatialEffects }],
		},
	};
	const bgOnly: ProgrammaticSource = {
		...combined,
		recipe: { ...combined.recipe!, outputRoles: ["background"] },
	};
	const bgPixels = await capture(bgOnly, [texture]);
	const expected = new OffscreenCanvas(64, 64),
		ec = expected.getContext("2d")!;
	ec.putImageData(new ImageData(new Uint8ClampedArray(bgPixels), 64, 64), 0, 0);
	const fgCanvas = new OffscreenCanvas(64, 64);
	fgCanvas
		.getContext("2d")!
		.putImageData(new ImageData(new Uint8ClampedArray(baseline), 64, 64), 0, 0);
	ec.drawImage(fgCanvas, 0, 0);
	assert(
		(await postHash(await capture(combined, [texture]))) ===
			(await postHash(postPixels(expected))),
		"Combined output leaked background post into foreground or changed canonical layer order",
	);
	checks.push(
		"mixed CPU/GPU chains preserve authored order and exclude unselected roles",
	);
	label(6, "chain: base / all spatial / portrait / landscape / repeated");
	const chain = postSource(
		[texture],
		[...spatialEffects, { kind: "grain", amount: 0.05, fps: 12 }],
	);
	await capture(postSource([texture]), [texture], 0, [6, 0]);
	const chainData = await capture(chain, [texture], 0, [6, 1]);
	for (const [i, [width, height]] of [
		[48, 96],
		[96, 48],
	].entries()) {
		const s = { ...chain, width, height },
			a = await capture(s, [texture], 8, [6, i + 2]);
		const b = await capture(s, [texture], 0),
			c = await capture(s, [texture], 8);
		assert(
			a.length === width * height * 4 &&
				(await postHash(a)) === (await postHash(c)),
			"Non-square post seek/dimensions failed",
		);
		assert(
			(await postHash(a)) !== (await postHash(b)),
			"Non-square clock ignored",
		);
	}
	assert(
		(await postHash(await capture(chain, [texture], 0, [6, 4]))) ===
			(await postHash(chainData)),
		"Chain seek state leaked",
	);
	assert(
		document.querySelectorAll("iframe").length === 0,
		"Post sandbox leaked",
	);
	checks.push(
		"full mixed chain, portrait/landscape frame sizes, no sandbox remnants",
	);
	return {
		passed: true,
		checks,
		captures,
		source: chain,
		resources: [texture],
	};
}

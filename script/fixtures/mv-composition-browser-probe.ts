import type {
	MvScene,
	ProgrammaticSource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
import {
	compositionSource,
	identityMap,
	panel,
	panelScene,
	texturedComposition,
} from "./mv-composition-fixture";
import {
	assertPost as assert,
	postAt as at,
	postCapture,
	postHash,
	postPixels,
	postResource,
} from "./mv-post-fixture";

export async function runMvCompositionProbe() {
	const checks: string[] = [];
	let captures = 0;
	const resources = await Promise.all(
		["red", "blue"].map((color, i) =>
			postResource(`${i}.png`, (c) => {
				c.fillStyle = color;
				c.fillRect(0, 0, 64, 64);
				c.fillStyle = "white";
				c.fillRect(i ? 44 : 4, 4, 16, 8);
				c.fillStyle = "lime";
				c.fillRect(16, 40, 8, 16);
			}),
		),
	);
	const sheet = document.createElement("canvas");
	sheet.id = "mv-composition-contact-sheet";
	sheet.width = 640;
	sheet.height = 5 * 152;
	document.body.append(sheet);
	const ctx = sheet.getContext("2d")!;
	ctx.fillStyle = "#182130";
	ctx.fillRect(0, 0, sheet.width, sheet.height);
	const capture = async (
		s: ProgrammaticSource,
		f: number,
		assets: ResolvedProgrammaticResource[] = resources,
		cell?: [number, number],
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
				const scale = 128 / Math.max(image.width, image.height),
					w = image.width * scale,
					h = image.height * scale;
				ctx.drawImage(image, x + (128 - w) / 2, y + (128 - h) / 2, w, h);
			}
			return postPixels(image, s.width, s.height);
		} finally {
			image.close();
		}
	};
	const label = (row: number, value: string) => {
		ctx.fillStyle = "white";
		ctx.font = "12px sans-serif";
		ctx.fillText(value, 4, row * 152 + 14);
	};
	const timed: MvScene = {
		kind: "ref",
		input: "a",
		timeMap: [
			{ atFrame: 0, sourceFrame: 0 },
			{ atFrame: 8, sourceFrame: 8 },
			{ atFrame: 12, sourceFrame: 8 },
			{ atFrame: 20, sourceFrame: 0 },
		],
	};
	const s = texturedComposition(timed, resources),
		direct: ProgrammaticSource = { ...s, recipe: { ...s.recipe!, root: "a" } };
	label(0, "play / freeze / rewind: f0 / f8 / f12 / f16 / f20");
	for (const [col, [f, mapped]] of [
		[0, 0],
		[8, 8],
		[12, 8],
		[16, 4],
		[20, 0],
	].entries()) {
		assert(
			(await postHash(await capture(s, f, resources, [0, col]))) ===
				(await postHash(await capture(direct, mapped))),
			`Mapped picture differs from source frame ${mapped}`,
		);
	}
	assert(
		(await postHash(await capture(s, 0))) !==
			(await postHash(await capture(s, 8))),
		"Reference froze all frames",
	);
	assert(
		(await postHash(await capture(s, 16))) ===
			(await postHash(await capture(s, 16))),
		"Reference reverse seek changed pixels",
	);
	checks.push(
		"integer map drives actual moving/quantized/swaying child pixels through playback, hold and rewind",
	);
	const sequence: MvScene = {
		kind: "sequence",
		items: [
			{
				input: "a",
				span: { startFrame: 0, durationFrames: 6 },
				timeMap: identityMap,
			},
			{
				input: "b",
				span: { startFrame: 8, durationFrames: 8 },
				timeMap: [
					{ atFrame: 8, sourceFrame: 0 },
					{ atFrame: 15, sourceFrame: 14 },
				],
			},
		],
	};
	const seq = texturedComposition(sequence, resources);
	label(1, "sequence: f4 / gap6 / cut8 / f15 / gap16");
	for (const [col, f] of [4, 6, 8, 15, 16].entries()) {
		const bytes = await capture(seq, f, resources, [1, col]);
		if (f === 6 || f === 16)
			assert(
				bytes.every((v) => v === 0),
				`Sequence gap ${f} not transparent`,
			);
		else {
			const target = f < 6 ? "a" : "b",
				mapped = f < 6 ? f : (f - 8) * 2;
			const plain = { ...seq, recipe: { ...seq.recipe!, root: target } };
			assert(
				(await postHash(bytes)) ===
					(await postHash(await capture(plain, mapped))),
				"Sequence did not sample the selected child clock",
			);
		}
	}
	const reverse: ProgrammaticSource = {
		...seq,
		recipe: {
			...seq.recipe!,
			root: "reverse",
			nodes: [
				...seq.recipe!.nodes,
				{
					id: "reverse",
					scene: {
						kind: "ref",
						input: "root",
						timeMap: [
							{ atFrame: 0, sourceFrame: 15 },
							{ atFrame: 15, sourceFrame: 0 },
						],
					},
				},
			],
		},
	};
	label(2, "rewind across shots: f0 / f4 / gap8 / f12 / f15");
	for (const [col, f] of [0, 4, 8, 12, 15].entries())
		assert(
			(await postHash(await capture(reverse, f, resources, [2, col]))) ===
				(await postHash(await capture(seq, 15 - f))),
			"Rewind failed across scene boundaries",
		);
	checks.push(
		"explicit half-open sequence intervals, transparent gaps, local rates and cross-shot rewind",
	);
	const flat = compositionSource(panelScene());
	const closed = await capture(flat, 0, []);
	assert(
		closed.every((v) => v === 0),
		"Panels visible before opening",
	);
	const opening = await capture(flat, 1, []);
	assert(
		at(opening, 4, 32).join() === "255,0,0,255" && at(opening, 24, 32)[3] === 0,
		"Panel directional reveal failed",
	);
	const landed = await capture(flat, 4, []);
	assert(
		at(landed, 10, 32).join() === "255,0,0,255" &&
			at(landed, 50, 32).join() === "0,0,255,255" &&
			at(landed, 32, 32)[3] === 0,
		"Panel layout/gutter incorrect",
	);
	const collapsing = await capture(flat, 12, []);
	assert(
		at(collapsing, 40, 32).join() === "255,0,0,255" &&
			at(collapsing, 55, 32).join() === "0,0,255,255",
		"Hero expansion did not replace region",
	);
	const last = await capture(flat, 16, []);
	assert(
		at(last, 63, 63).join() === "255,0,0,255",
		"Hero failed to fill exact endpoint",
	);
	const transparent: ProgrammaticSource = {
		...flat,
		recipe: {
			...flat.recipe!,
			nodes: flat.recipe!.nodes.map((n) =>
				n.id === "a"
					? {
							...n,
							scene: { kind: "solid", role: "foreground", color: [0, 0, 0, 0] },
						}
					: n,
			),
		},
	};
	assert(
		at(await capture(transparent, 12, []), 40, 32)[3] === 0,
		"Transparent hero left the other shot behind",
	);
	const borderedScene = panelScene();
	if (borderedScene.kind !== "panels") throw Error("Bad panel fixture");
	const bordered = compositionSource({
		...borderedScene,
		border: { color: [0, 1, 0, 1], width: 0.04, role: "graphics" },
	});
	assert(
		(await postHash(await capture(bordered, 4, []))) ===
			(await postHash(landed)),
		"Border painted unselected role",
	);
	const bordersOnly = {
		...bordered,
		recipe: { ...bordered.recipe!, outputRoles: ["graphics" as const] },
	};
	const borderPixels = await capture(bordersOnly, 4, []);
	assert(
		at(borderPixels, 28, 32)[1] > 240 && at(borderPixels, 10, 32)[3] === 0,
		"Border did not isolate decorative role",
	);
	checks.push(
		"independent panel pixel landmarks: reveal, gutter, hero expansion, transparent replacement and border role",
	);
	const pictured = texturedComposition(panelScene(), resources);
	label(3, "moving panels: f1 / f4 / f8 / f12 / f16");
	for (const [col, f] of [1, 4, 8, 12, 16].entries())
		await capture(pictured, f, resources, [3, col]);
	const triangles: MvScene = {
		kind: "panels",
		panels: [
			panel("a", [
				[0, 0],
				[1, 0],
				[0, 1],
			]),
			panel("b", [
				[1, 0.05],
				[1, 1],
				[0.05, 1],
			]),
		],
		collapse: {
			span: { startFrame: 8, durationFrames: 8 },
			hero: 1,
			easing: "inOutSine",
		},
	};
	const triangular = texturedComposition(triangles, resources);
	label(4, "triangles / clockwise / portrait / landscape / hero");
	const normal = await capture(triangular, 4, resources, [4, 0]);
	const clockwise = texturedComposition(
		{
			...triangles,
			panels: triangles.panels.map((p) => ({
				...p,
				polygon: [...p.polygon].reverse(),
			})),
		},
		resources,
	);
	assert(
		(await postHash(await capture(clockwise, 4, resources, [4, 1]))) ===
			(await postHash(normal)),
		"Panel winding changed pixels",
	);
	for (const [col, [width, height]] of [
		[48, 96],
		[96, 48],
	].entries()) {
		const sized = { ...triangular, width, height },
			a = await capture(sized, 8, resources, [4, col + 2]);
		await capture(sized, 16);
		assert(
			(await postHash(await capture(sized, 8))) === (await postHash(a)),
			"Panel non-square seek changed pixels",
		);
	}
	await capture(triangular, 16, resources, [4, 4]);
	assert(
		document.querySelectorAll("iframe").length === 0,
		"Composition leaked sandbox",
	);
	checks.push(
		"real moving panel content, both convex windings, portrait/landscape and random seek",
	);
	return { passed: true, checks, captures, source: pictured, resources };
}

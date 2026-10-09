import type {
	MvTransition,
	ProgrammaticSource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
import { renderProgrammaticCanvas } from "../../packages/editor-classic/src/services/renderer/programmatic/canvas-runtime";
import { resolveProgrammaticFrame } from "../../packages/editor-classic/src/services/renderer/programmatic/frame";
import {
	transitionStyles,
	transitionSource,
	texturedSource,
	pictureResource,
	equal,
	pixels,
	at,
	hash,
} from "./mv-transition-fixture";

export async function runMvTransitionProbe() {
	const resources = [
		await pictureResource("from.png", false),
		await pictureResource("to.png", true),
	];
	let captures = 0;
	const render = async (
		source: ProgrammaticSource,
		index: number,
		assets: ResolvedProgrammaticResource[] = [],
	) => {
		const frame = resolveProgrammaticFrame({
			source,
			clipStart: 0,
			clipDuration: 120000,
			trimStart: 0,
			timelineTime: index * 5000,
		})!;
		const bitmap = await renderProgrammaticCanvas({
			source,
			frame,
			resources: assets,
		});
		captures++;
		return bitmap;
	};
	const sample = async (
		source: ProgrammaticSource,
		index: number,
		assets: ResolvedProgrammaticResource[] = [],
	) => {
		const image = await render(source, index, assets);
		try {
			return pixels(image);
		} finally {
			image.close();
		}
	};
	const sheet = document.createElement("canvas");
	sheet.id = "mv-transition-contact-sheet";
	sheet.width = 5 * 144;
	sheet.height = 13 * 154;
	const ctx = sheet.getContext("2d")!;
	ctx.fillStyle = "#151821";
	ctx.fillRect(0, 0, sheet.width, sheet.height);
	ctx.font = "12px sans-serif";
	document.body.append(sheet);
	const checks: string[] = [];
	const fingerprints = new Set<string>();
	for (const [row, style] of transitionStyles.entries()) {
		const source = texturedSource(style, resources);
		for (const [column, index] of [3, 4, 6, 8, 12].entries()) {
			const image = await render(source, index, resources);
			try {
				if (index === 3 || index === 4 || index === 12) {
					const expected = await render(
						{
							...source,
							recipe: {
								...source.recipe!,
								root:
									index === 12 || (index === 4 && style.kind === "cut")
										? "b"
										: "a",
							},
						},
						index,
						resources,
					);
					try {
						equal(
							`${style.kind} endpoint ${index}`,
							await hash(image),
							await hash(expected),
						);
					} finally {
						expected.close();
					}
				}
				if (index === 8) {
					const first = await hash(image),
						earlier = await render(source, 5, resources);
					earlier.close();
					const repeated = await render(source, 8, resources);
					try {
						equal(`${style.kind} reverse seek`, await hash(repeated), first);
					} finally {
						repeated.close();
					}
					fingerprints.add(first);
				}
				ctx.drawImage(image, column * 144 + 8, row * 154 + 22, 128, 128);
				ctx.fillStyle = "white";
				ctx.fillText(
					`${style.kind} / f${index}`,
					column * 144 + 8,
					row * 154 + 15,
				);
			} finally {
				image.close();
			}
		}
	}
	if (fingerprints.size !== 13)
		throw Error(
			`Mechanism collision: ${fingerprints.size} distinct midpoint pictures`,
		);
	checks.push(
		"all 13 transitions use real moving A/B image inputs, exact handles and reverse-seek determinism",
	);
	const rgb = (
		name: string,
		data: Uint8ClampedArray,
		x: number,
		y: number,
		expected: number[],
	) => equal(name, at(data, x, y), expected);
	for (const style of transitionStyles) {
		const data = await sample(transitionSource(style), 8);
		switch (style.kind) {
			case "cut":
				rgb("cut B", data, 8, 8, [0, 0, 255, 255]);
				break;
			case "xfade":
				rgb("premultiplied xfade", data, 8, 8, [128, 0, 128, 255]);
				break;
			case "flash":
				rgb("flash peak", data, 8, 8, [255, 255, 255, 255]);
				break;
			case "black":
				rgb("black peak", data, 8, 8, [0, 0, 0, 255]);
				break;
			case "iris":
				rgb("iris center B", data, 32, 32, [0, 0, 255, 255]);
				rgb("iris corner A", data, 2, 2, [255, 0, 0, 255]);
				break;
			case "irisClose":
				rgb("irisClose center A", data, 32, 32, [255, 0, 0, 255]);
				rgb("irisClose corner B", data, 2, 2, [0, 0, 255, 255]);
				break;
			case "wipe":
				rgb("wipe left B", data, 8, 8, [0, 0, 255, 255]);
				rgb("wipe right A", data, 56, 8, [255, 0, 0, 255]);
				break;
			case "push":
				rgb("push translates A", data, 8, 8, [255, 0, 0, 255]);
				rgb("push translates B", data, 56, 8, [0, 0, 255, 255]);
				break;
			case "barrier":
				rgb("barrier reveals top", data, 8, 8, [0, 0, 255, 255]);
				rgb("barrier retains bottom", data, 8, 56, [255, 0, 0, 255]);
				break;
			case "slices": {
				const earlier = await sample(transitionSource(style), 6);
				rgb("even slice from left", earlier, 1, 8, [0, 0, 255, 255]);
				rgb("odd slice from right", earlier, 1, 24, [255, 0, 0, 255]);
				break;
			}
			case "zoom": {
				const corner = at(data, 0, 0),
					center = at(data, 32, 32);
				if (
					corner[0] < 250 ||
					corner[2] > 2 ||
					corner[3] >= 255 ||
					center[2] < 230
				)
					throw Error("Zoom did not scale/fade two real images");
				break;
			}
			case "ink":
			case "shatter": {
				let red = 0,
					blue = 0;
				for (let i = 0; i < data.length; i += 4) {
					if (data[i] > 150) red++;
					if (data[i + 2] > 150) blue++;
				}
				if (!red || !blue)
					throw Error(`${style.kind} must expose B and retain parts of A`);
				break;
			}
		}
	}
	checks.push(
		"independent pixel landmarks for every mechanism, including staggered bands and scaled zoom",
	);
	for (const direction of ["right", "up", "down"] as const) {
		const data = await sample(transitionSource({ kind: "push", direction }), 8);
		rgb(
			`push ${direction}`,
			data,
			8,
			8,
			direction === "up" ? [255, 0, 0, 255] : [0, 0, 255, 255],
		);
	}
	for (const kind of ["flash", "black"] as const) {
		const source = texturedSource(
			kind === "flash" ? { kind, color: [1, 1, 1, 1] } : { kind },
			resources,
		);
		const nodes = source.recipe!.nodes.map((n) =>
			n.scene.kind === "illust"
				? {
						...n,
						scene: {
							...n.scene,
							sprites: n.scene.sprites!.map((s) => ({
								...s,
								from: { ...s.from, height: 0.5 },
								to: { ...s.to, height: 0.5 },
							})),
						},
					}
				: n,
		);
		const data = await sample(
			{ ...source, recipe: { ...source.recipe!, nodes } },
			8,
			resources,
		);
		rgb(`${kind} preserves foreground alpha`, data, 0, 0, [0, 0, 0, 0]);
	}
	for (const style of [
		{ kind: "ink", seed: 37, blobs: 1 },
		{ kind: "shatter", seed: 37, center: [0.5, 0.5], columns: 9, rows: 5 },
	] as const) {
		const a = transitionSource(style),
			b = { ...a, seed: 8 };
		const first = await sample(a, 6),
			second = await sample(b, 6);
		if (first.every((v, i) => v === second[i]))
			throw Error(`${style.kind} ignored its seed`);
	}
	checks.push(
		"all push directions, alpha-preserving flash/black and independent seeded mask/shard variation",
	);
	const decoration: MvTransition = {
		kind: "iris",
		center: [0.5, 0.5],
		edge: { color: [0, 1, 0, 1], width: 0.04, role: "graphics" },
	};
	const decorated = transitionSource(decoration),
		empty = {
			...decorated,
			recipe: { ...decorated.recipe!, outputRoles: ["graphics"] as const },
		};
	const decoratedPixels = await sample(empty, 8);
	if (!decoratedPixels.some((v, i) => i % 4 === 3 && v > 0))
		throw Error("Selected decoration role rendered no edge");
	const noEdge = await sample(
		{
			...decorated,
			recipe: { ...decorated.recipe!, outputRoles: ["subject"] },
		},
		8,
	);
	if (noEdge.some((v) => v))
		throw Error("Decorative edge leaked into an unselected role");
	checks.push(
		"decorations have explicit semantic roles, not duplicated into every output",
	);
	for (const [width, height] of [
		[96, 48],
		[48, 96],
	])
		for (const style of transitionStyles) {
			const image = await render(
				{ ...transitionSource(style), width, height },
				8,
			);
			try {
				const canvas = new OffscreenCanvas(width, height),
					c = canvas.getContext("2d")!;
				c.drawImage(image, 0, 0);
				const point = (x: number, y: number) => [
					...c.getImageData(x, y, 1, 1).data,
				];
				if (style.kind === "iris")
					equal(
						"aspect-aware iris center",
						point(width / 2, height / 2),
						[0, 0, 255, 255],
					);
				if (style.kind === "irisClose")
					equal(
						"aspect-aware irisClose center",
						point(width / 2, height / 2),
						[255, 0, 0, 255],
					);
				if (style.kind === "wipe")
					equal(
						"aspect-aware wipe right",
						point(width * 0.875, height * 0.125),
						[255, 0, 0, 255],
					);
				if (style.kind === "push")
					equal(
						"aspect-aware push right",
						point(width * 0.875, height * 0.125),
						[0, 0, 255, 255],
					);
				if (style.kind === "barrier")
					equal(
						"aspect-aware barrier top",
						point(width * 0.125, height * 0.125),
						[0, 0, 255, 255],
					);
				if (
					![...c.getImageData(0, 0, width, height).data].some(
						(v, i) => i % 4 === 3 && v > 0,
					)
				)
					throw Error(`${style.kind} lost its ${width}x${height} output`);
			} finally {
				image.close();
			}
		}
	checks.push(
		"all 13 mechanisms render portrait and landscape sources with normalized geometry",
	);
	equal(
		"no transition sandbox left",
		document.querySelectorAll("iframe").length,
		0,
	);
	return {
		passed: true,
		checks,
		captures,
		mechanisms: transitionStyles.map((s) => s.kind),
		source: texturedSource(transitionStyles[12], resources),
		resources,
	};
}

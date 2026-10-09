import { pictureResource } from "./mv-transition-fixture";
import {
	peelSource,
	peelStyle,
	peelWithNodes,
	peelWithStyle,
} from "./peel-fixture";
import { assertGenerator as assert } from "./generator-browser-assets";
import { generatorCapture, clearPixels } from "./generator-capture";
import { exportGenerators } from "./generator-export-probe";

export async function runPeelProbe() {
	const resources = [
		await pictureResource("from.png", false),
		await pictureResource("to.png", true),
	];
	const { capture, count } = generatorCapture(resources);
	const source = peelSource(resources);
	const sheet = document.createElement("canvas");
	sheet.width = 960;
	sheet.height = 432;
	const ctx = sheet.getContext("2d")!;
	ctx.fillStyle = "#102030";
	ctx.fillRect(0, 0, sheet.width, sheet.height);
	document.body.append(sheet);
	const stamp = (pixels: Uint8ClampedArray, col: number, row: number) => {
		const cell = new OffscreenCanvas(192, 108);
		cell
			.getContext("2d")!
			.putImageData(
				new ImageData(new Uint8ClampedArray(pixels), 192, 108),
				0,
				0,
			);
		ctx.drawImage(cell, col * 192, row * 108);
	};
	const directions = ["left", "right", "up", "down"] as const,
		hashes: string[] = [];
	for (const [row, direction] of directions.entries()) {
		const input = peelSource(resources, peelStyle(direction));
		for (const [col, frame] of [6, 12, 21, 30, 36].entries()) {
			const result = await capture(input, frame);
			stamp(result.pixels, col, row);
			if (frame === 6 || frame === 36) {
				const reference = {
					...input,
					recipe: { ...input.recipe!, root: frame === 6 ? "a" : "b" },
				};
				assert(
					result.hash === (await capture(reference, frame)).hash,
					`Peel ${direction} endpoint mismatch`,
				);
			}
			if (frame === 21) hashes.push(result.hash);
		}
		await capture(input, 10);
		assert(
			(await capture(input, 21)).hash === hashes[row],
			`Peel ${direction} reverse seek changed pixels`,
		);
	}
	assert(new Set(hashes).size === 4, "Peel directions do not differ");
	// Constant opaque inputs expose triangle cracks and half-alpha clip seams.
	for (const direction of directions) {
		const opaque = peelWithNodes(
			peelSource(resources, { ...peelStyle(direction), shading: 0 }),
			source.recipe!.nodes.map((n) =>
				n.id === "mix"
					? {
							...n,
							scene: {
								...n.scene,
								style: { ...peelStyle(direction), shading: 0 },
							},
						}
					: {
							id: n.id,
							scene: {
								kind: "solid",
								role: "foreground",
								color: n.id === "a" ? [1, 0, 0, 1] : [0, 0, 1, 1],
							},
						},
			),
		);
		for (const frame of [7, 12, 21, 35]) {
			const { pixels } = await capture(opaque, frame);
			assert(
				pixels.every((v, i) => i % 4 !== 3 || v === 255),
				`Peel ${direction} has raster cracks at ${frame}`,
			);
			assert(
				pixels.every((v, i) => i % 4 === 3 || v === 0 || v === 255),
				`Peel ${direction} mixes adjacent triangles`,
			);
		}
	}
	for (const style of [
		{ kind: "xfade" } as const,
		{ kind: "wipe", angle: 0 } as const,
		{ ...peelStyle(), curl: 0.3 },
		{ ...peelStyle(), perspective: 0 },
		{ ...peelStyle(), shading: 0 },
	]) {
		assert(
			(await capture(peelWithStyle(source, style), 21)).hash !== hashes[0],
			"Peel ignored parameters or used a fade/wipe surrogate",
		);
	}
	for (const id of ["a", "b"]) {
		const changed = peelWithNodes(
			source,
			source.recipe!.nodes.map((n) =>
				n.id === id
					? {
							id,
							scene: { kind: "solid", role: "foreground", color: [0, 1, 1, 1] },
						}
					: n,
			),
		);
		assert(
			(await capture(changed, 21)).hash !== hashes[0],
			`Peel does not consume ${id}`,
		);
	}
	assert(
		(await capture(source, 18, { trim: 12000 })).hash === hashes[0],
		"Peel trim mapping failed",
	);
	const fractional = {
		...source,
		frameRate: { numerator: 24000, denominator: 1001 },
	};
	assert(
		(await capture(fractional, 21)).hash === hashes[0],
		"Peel frame progress changed with rational fps",
	);
	const transparent = peelWithNodes(
		source,
		source.recipe!.nodes.map((n) =>
			n.scene.kind === "illust"
				? {
						...n,
						scene: {
							...n.scene,
							sprites: n.scene.sprites!.map((s) => ({
								...s,
								from: { ...s.from, height: 0.6, opacity: 0.5 },
								to: { ...s.to, height: 0.6, opacity: 0.5 },
							})),
						},
					}
				: n,
		),
	);
	const alpha = await capture(transparent, 21),
		unshaded = await capture(
			peelWithStyle(transparent, { ...peelStyle(), shading: 0 }),
			21,
		);
	assert(
		alpha.pixels.some((v, i) => i % 4 === 3 && v === 0) &&
			alpha.pixels.some((v, i) => i % 4 === 3 && v > 0 && v < 255),
		"Peel discarded alpha",
	);
	assert(
		alpha.pixels.every((v, i) => i % 4 !== 3 || v === unshaded.pixels[i]),
		"Peel shading changed alpha",
	);
	assert(
		clearPixels(
			(
				await capture(
					{
						...source,
						recipe: { ...source.recipe!, outputRoles: ["subject"] },
					},
					21,
				)
			).pixels,
		),
		"Peel leaked unselected roles",
	);
	for (const [width, height] of [
		[96, 192],
		[256, 96],
	]) {
		const resized = { ...source, width, height },
			first = await capture(resized, 21);
		await capture(resized, 36);
		assert(
			first.hash === (await capture(resized, 21)).hash,
			"Peel aspect ratio/seek failed",
		);
	}
	const controller = new AbortController(),
		pending = capture(source, 21, { signal: controller.signal });
	controller.abort(new DOMException("Probe cancelled", "AbortError"));
	let cancelled = false;
	try {
		await pending;
	} catch (e) {
		cancelled = e instanceof DOMException && e.name === "AbortError";
	}
	assert(
		cancelled && (await capture(source, 21)).hash === hashes[0],
		"Peel cancel/recover failed",
	);
	const video = await exportGenerators([source], resources, {
		startTime: 84000,
		requireAlpha: false,
	});
	assert(
		document.querySelectorAll("iframe").length === 0,
		"Peel sandbox leaked",
	);
	Reflect.set(globalThis, "__stylizedSheet", sheet.toDataURL("image/png"));
	return {
		ok: true,
		captures: count(),
		directionHashes: hashes,
		video,
		descriptors: resources.map((r) => r.resource),
		checks: [
			"real independently moving A/B textures",
			"exact first/last handles",
			"four directions",
			"reverse seek",
			"shading/curl/perspective",
			"not a fade/wipe",
			"nonzero trim",
			"rational fps",
			"transparent alpha unchanged by shading",
			"selected roles",
			"portrait/landscape",
			"cancel/recover",
			"preview/export same frame",
			"real video encode/decode",
			"no leaked iframe",
		],
	};
}

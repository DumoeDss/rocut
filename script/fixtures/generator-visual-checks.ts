import type { ProgrammaticSource } from "@opencut/editor-contracts";
import {
	assertGenerator as assert,
	generatorHash,
	generatorPixels,
} from "./generator-browser-assets";
import { clearPixels, type GeneratorCapture } from "./generator-capture";
import { glyphScene, particleScene } from "./generator-fixture";

export type GeneratorStamp = (
	pixels: Uint8ClampedArray,
	col: number,
	row: number,
) => void;
export async function checkGlyphRain(
	source: ProgrammaticSource,
	capture: GeneratorCapture,
	stamp: GeneratorStamp,
) {
	const zero = await capture(source, 0),
		one = await capture(source, 1),
		later = await capture(source, 3);
	assert(
		zero.hash === one.hash && zero.hash !== later.hash,
		"Glyph Rain drawing clock ignored",
	);
	assert(
		(await capture(source, 0)).hash === zero.hash,
		"Glyph Rain reverse seek changed frame",
	);
	assert(
		zero.pixels.some((v, i) => i % 4 === 3 && v > 0 && v < 255) &&
			zero.pixels.some((v, i) => i % 4 === 3 && v === 0),
		"Glyph Rain alpha missing",
	);
	const seeded = await capture({ ...source, seed: 31 }, 3);
	assert(seeded.hash !== later.hash, "Glyph Rain seed ignored");
	const fractional = {
		...source,
		frameRate: { numerator: 24000, denominator: 1001 },
	};
	const f0 = await capture(fractional, 0);
	assert(
		f0.hash === (await capture(fractional, 1)).hash &&
			f0.hash !== (await capture(fractional, 2)).hash,
		"Fractional glyph clock failed",
	);
	assert(
		(await capture(source, 0, { trim: 12000 })).hash === later.hash,
		"Glyph Rain trim ignored",
	);
	const reversed: ProgrammaticSource = {
		...source,
		recipe: {
			...source.recipe!,
			root: "reverse",
			nodes: [
				...source.recipe!.nodes,
				{
					id: "reverse",
					scene: {
						kind: "ref",
						input: "generator",
						timeMap: [
							{ atFrame: 0, sourceFrame: 3 },
							{ atFrame: 3, sourceFrame: 0 },
						],
					},
				},
			],
		},
	};
	assert(
		(await capture(reversed, 0)).hash === later.hash &&
			(await capture(reversed, 3)).hash === zero.hash,
		"Referenced glyph clock failed",
	);
	const hidden = {
		...source,
		recipe: { ...source.recipe!, outputRoles: ["background" as const] },
	};
	assert(
		clearPixels((await capture(hidden, 0)).pixels),
		"Glyph Rain ignored output role",
	);
	const muted = glyphScene();
	assert(
		clearPixels(
			(
				await capture(
					{
						...source,
						recipe: {
							...source.recipe!,
							nodes: [
								{
									id: "generator",
									scene: {
										...muted,
										settings: { ...muted.settings, opacity: 0 },
									},
								},
							],
						},
					},
					0,
				)
			).pixels,
		),
		"Glyph Rain zero opacity failed",
	);
	stamp(zero.pixels, 0, 0);
	stamp(one.pixels, 1, 0);
	stamp(later.pixels, 2, 0);
	stamp(seeded.pixels, 3, 0);
	return { frame0: zero.hash, frame3: later.hash, changedSeed: seeded.hash };
}
export async function checkParticleReveal(
	source: ProgrammaticSource,
	capture: GeneratorCapture,
	stamp: GeneratorStamp,
	image: OffscreenCanvas,
) {
	const empty = await capture(source, 0),
		middle = await capture(source, 8),
		full = await capture(source, 24);
	assert(
		clearPixels(empty.pixels) &&
			!clearPixels(middle.pixels) &&
			middle.hash !== full.hash,
		"Particle reveal endpoints/midpoint failed",
	);
	const expected = new OffscreenCanvas(192, 108),
		ctx = expected.getContext("2d")!;
	ctx.drawImage(image, 24, 0, 144, 108);
	const expectedPixels = generatorPixels(expected, 192, 108);
	assert(
		full.hash === (await generatorHash(new Uint8Array(expectedPixels).buffer)),
		"Particle reveal endpoint has seams/fit/alpha error",
	);
	assert(
		middle.pixels.some(
			(v, i) => i % 4 === 3 && v > 16 && expectedPixels[i] === 0,
		),
		"Particle reveal is only a fade, no scattered geometry",
	);
	assert(
		(await capture(source, 8)).hash === middle.hash,
		"Particle reverse seek changed frame",
	);
	const scene = particleScene();
	const withSettings = (settings: Partial<typeof scene.settings>) => ({
		...source,
		recipe: {
			...source.recipe!,
			nodes: [
				{
					id: "generator",
					scene: { ...scene, settings: { ...scene.settings, ...settings } },
				},
			],
		},
	});
	const out = withSettings({ direction: "out" });
	assert(
		(await capture(out, 0)).hash === full.hash &&
			clearPixels((await capture(out, 24)).pixels),
		"Particle reverse direction failed",
	);
	assert(
		(await capture({ ...source, seed: 31 }, 8)).hash !== middle.hash,
		"Particle seed ignored",
	);
	assert(
		(await capture(withSettings({ scatter: 0, spin: 0, columns: 4 }), 8))
			.hash !== middle.hash,
		"Particle geometry parameters ignored",
	);
	const cover = await capture(withSettings({ fit: "cover" }), 24),
		stretch = await capture(withSettings({ fit: "stretch" }), 24);
	assert(
		new Set([full.hash, cover.hash, stretch.hash]).size === 3,
		"Particle image fit ignored",
	);
	assert(
		clearPixels((await capture(withSettings({ opacity: 0 }), 8)).pixels),
		"Particle opacity failed",
	);
	assert(
		clearPixels(
			(
				await capture(
					{
						...source,
						recipe: { ...source.recipe!, outputRoles: ["background"] },
					},
					8,
				)
			).pixels,
		),
		"Particle output role failed",
	);
	stamp(empty.pixels, 0, 1);
	stamp(middle.pixels, 1, 1);
	stamp(full.pixels, 2, 1);
	stamp(cover.pixels, 3, 1);
	return { frame0: empty.hash, frame8: middle.hash, frame24: full.hash };
}

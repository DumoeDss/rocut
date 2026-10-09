import { assert, effect, hash, spatialScene } from "./spatial-probe-scene";
import {
	changedPixels,
	checkRevealTimeline,
	revealAlpha,
	type RevealCapture,
	type RevealReferences,
} from "./reveal-effects-common";

export async function checkDecrypt(
	capture: RevealCapture,
	references: RevealReferences,
) {
	const { baseline, black, white } = references;
	const params = {
		amount: 1,
		progress: 0,
		cellSize: 12,
		contrast: 1,
		seed: 1,
		centerX: 0.5,
		centerY: 0.5,
		radius: 2,
		feather: 0,
		colorR: 0.2,
		colorG: 1,
		colorB: 0.55,
	};
	const characters = await capture(
		spatialScene([effect("decrypt-reveal", params)]),
	);
	let ink = 0,
		blackPixels = 0,
		gapPixels = 0;
	for (let y = 0; y < 360; y++)
		for (let x = 0; x < 640; x++) {
			const i = (y * 640 + x) * 4;
			if (white[i] !== black[i]) continue;
			const blank = [0, 1, 2].every((c) => characters[i + c] === 0);
			if (blank) blackPixels++;
			else {
				ink++;
				assert(
					[51, 255, 140].every((v, c) => Math.abs(characters[i + c] - v) <= 1),
					"Decrypt characters must use their configured ink color, not source tint",
				);
			}
			if (x % 12 >= 10 || y % 16 >= 14) {
				gapPixels++;
				assert(blank, `Decrypt 5x7 glyph escaped its 6x8 cell at ${x},${y}`);
			}
		}
	assert(
		ink > 2000 && blackPixels > 10000 && gapPixels > 5000,
		`Decrypt character structure ${JSON.stringify({ ink, blackPixels, gapPixels })}`,
	);
	const baseHash = await hash(baseline),
		characterHash = await hash(characters);
	for (const controls of [{ progress: 1 }, { amount: 0 }])
		assert(
			(await hash(
				await capture(
					spatialScene([effect("decrypt-reveal", { ...params, ...controls })]),
				),
			)) === baseHash,
			"Decrypt global endpoint/zero amount differs from input",
		);
	assert(
		(await hash(
			await capture(
				spatialScene([
					effect("decrypt-reveal", { ...params, progress: 1, radius: 0 }),
				]),
			),
		)) === characterHash,
		"Zero radius must remain fully encrypted",
	);
	let regional = characters;
	const regions = [];
	for (const [centerX, centerY] of [
		[0.25, 0.45],
		[0.7, 0.55],
	]) {
		const actual = await capture(
			spatialScene([
				effect("decrypt-reveal", {
					...params,
					progress: 1,
					radius: 0.24,
					centerX,
					centerY,
				}),
			]),
		);
		let innerPixels = 0,
			outerPixels = 0;
		for (let y = 0; y < 360; y++)
			for (let x = 0; x < 640; x++) {
				const distance = Math.hypot(
					x + 0.5 - centerX * 640,
					y + 0.5 - centerY * 360,
				);
				if (Math.abs(distance - 86.4) < 0.1) continue;
				const inside = distance < 86.4,
					i = (y * 640 + x) * 4;
				if (inside) innerPixels++;
				else outerPixels++;
				const expected = inside ? baseline : characters;
				assert(
					[0, 1, 2, 3].every((c) => actual[i + c] === expected[i + c]),
					`Decrypt moved region ${centerX},${centerY} at ${x},${y}`,
				);
			}
		assert(
			innerPixels > 20000 && outerPixels > 150000,
			"Decrypt region oracle must cover substantial inside and outside populations",
		);
		regions.push({ centerX, centerY, innerPixels, outerPixels });
		regional = actual;
	}
	const larger = await capture(
		spatialScene([effect("decrypt-reveal", { ...params, cellSize: 20 })]),
	);
	const sizeDifference = changedPixels(characters, larger);
	assert(
		sizeDifference > 5000,
		"Decrypt cell size did not change character geometry",
	);
	const middle = await capture(
		spatialScene([effect("decrypt-reveal", { ...params, progress: 0.5 })]),
	);
	const reseeded = await capture(
		spatialScene([
			effect("decrypt-reveal", { ...params, progress: 0.5, seed: 2 }),
		]),
	);
	const seedDifference = changedPixels(middle, reseeded);
	assert(
		seedDifference > 5000,
		"Decrypt seed did not change independently revealed cells",
	);
	let originalCells = 0,
		encryptedCells = 0,
		mixedCells = 0;
	for (let i = 0; i < middle.length; i += 4) {
		if (
			![0, 1, 2].some((c) => Math.abs(baseline[i + c] - characters[i + c]) > 20)
		)
			continue;
		if ([0, 1, 2].every((c) => Math.abs(middle[i + c] - baseline[i + c]) <= 1))
			originalCells++;
		else if (
			[0, 1, 2].every((c) => Math.abs(middle[i + c] - characters[i + c]) <= 1)
		)
			encryptedCells++;
		else mixedCells++;
	}
	assert(
		originalCells > 5000 && encryptedCells > 5000 && mixedCells > 1000,
		`Decrypt must reveal per cell, not globally fade: ${JSON.stringify({ originalCells, encryptedCells, mixedCells })}`,
	);
	const alpha = await revealAlpha(
		capture,
		"decrypt-reveal",
		params,
		references,
		"preserve",
	);
	const timeline = await checkRevealTimeline(
		capture,
		"decrypt-reveal",
		{ ...params, radius: 0.35 },
		{
			progress: [0.2, 0.8],
			centerX: [0.25, 0.75],
			centerY: [0.35, 0.65],
		},
	);
	return {
		evidence: {
			ink,
			blackPixels,
			gapPixels,
			regions,
			sizeDifference,
			seedDifference,
			originalPixels: originalCells,
			encryptedPixels: encryptedCells,
			mixedPixels: mixedCells,
			alpha,
			timeline,
		},
		pixels: [characters, regional, middle],
	};
}

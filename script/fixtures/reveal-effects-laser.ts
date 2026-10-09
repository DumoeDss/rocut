import { assert, effect, hash, spatialScene } from "./spatial-probe-scene";
import {
	changedPixels,
	checkRevealTimeline,
	revealAlpha,
	type RevealCapture,
	type RevealReferences,
} from "./reveal-effects-common";

export async function checkLaser(
	capture: RevealCapture,
	references: RevealReferences,
) {
	const { baseline } = references;
	const baseHash = await hash(baseline);
	const params = {
		amount: 1,
		progress: 0.5,
		direction: 0,
		width: 0,
		feather: 0,
		glow: 0.8,
		colorR: 0.2,
		colorG: 0.85,
		colorB: 1,
	};
	const litParams = { ...params, width: 0.08, feather: 0.35, glow: 0.8 };
	const hidden = await capture(
		spatialScene([effect("laser", { ...litParams, progress: 0 })]),
	);
	for (let i = 0; i < hidden.length; i += 4)
		assert(
			hidden[i] === 32 &&
				hidden[i + 1] === 48 &&
				hidden[i + 2] === 64 &&
				hidden[i + 3] === 255,
			"Laser progress 0 must expose only the scene background",
		);
	for (const controls of [{ progress: 1 }, { amount: 0, progress: 0 }])
		assert(
			(await hash(
				await capture(
					spatialScene([effect("laser", { ...litParams, ...controls })]),
				),
			)) === baseHash,
			"Laser endpoint/zero amount must preserve the original input",
		);
	const directions = [];
	let halfway = baseline;
	for (let direction = 0; direction < 4; direction++) {
		const actual = await capture(
			spatialScene([effect("laser", { ...params, direction })]),
		);
		if (direction === 0) halfway = actual;
		let visible = 0,
			hiddenPixels = 0;
		for (let y = 0; y < 360; y++)
			for (let x = 0; x < 640; x++) {
				const show =
					direction === 0
						? x < 320
						: direction === 1
							? x >= 320
							: direction === 2
								? y < 180
								: y >= 180;
				const i = (y * 640 + x) * 4;
				if (show) visible++;
				else hiddenPixels++;
				for (let c = 0; c < 4; c++)
					assert(
						actual[i + c] === (show ? baseline[i + c] : [32, 48, 64, 255][c]),
						`Laser direction ${direction} altered its revealed source or exposed the hidden side at ${x},${y}`,
					);
			}
		assert(
			changedPixels(actual, baseline) > 30000,
			"Laser direction did not visibly mask nonuniform input",
		);
		directions.push({ direction, visible, hiddenPixels });
	}
	const lit = await capture(spatialScene([effect("laser", litParams)]));
	const dark = await capture(
		spatialScene([effect("laser", { ...litParams, glow: 0 })]),
	);
	assert(changedPixels(lit, dark) > 300, "Laser glow has no visible effect");
	for (let y = 0; y < 360; y++)
		for (let x = 320; x < 640; x++) {
			const i = (y * 640 + x) * 4;
			assert(
				[32, 48, 64, 255].every((v, c) => lit[i + c] === v),
				"Laser glow/feather leaked ahead of the scan front",
			);
		}
	const alpha = [
		await revealAlpha(capture, "laser", litParams, references, "bounded"),
		await revealAlpha(
			capture,
			"laser",
			{ ...params, progress: 0, amount: 0.5 },
			references,
			"half",
		),
	];
	const timeline = await checkRevealTimeline(capture, "laser", litParams, {
		progress: [0.2, 0.8],
	});
	return {
		evidence: { directions, alpha, timeline, endpointPixels: 640 * 360 },
		pixels: [halfway, lit],
	};
}

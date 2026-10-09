import type { MvEffect } from "@opencut/editor-contracts";
import { at, assertGray, capture, check, digest } from "./mv-finishing-capture";
import {
	finishingSource,
	orderedFinishing,
	type FinishingEffect,
} from "./mv-finishing-source";
import { verifyFinishingRoles } from "./mv-finishing-roles";

export async function verifyFinishingPixels() {
	const checks: string[] = [],
		observations: Record<string, unknown> = {};
	const ordered = finishingSource({
		post: [{ stage: "composite", effects: orderedFinishing }],
	});
	const swap = finishingSource({
		post: [
			{
				stage: "composite",
				effects: [
					orderedFinishing[1],
					orderedFinishing[0],
					orderedFinishing[2],
				],
			},
		],
	});
	const orderedPixels = await capture(ordered),
		swappedPixels = await capture(swap);
	// Independent straight-alpha equations: .2 -> .35 -> .575 -> .46;
	// swapping invert/flash gives .2 -> .5 -> .5 -> .4.
	assertGray(orderedPixels, 117.3, "Ordered finishing");
	assertGray(swappedPixels, 102, "Swapped finishing");
	observations.order = {
		ordered: at(orderedPixels),
		swapped: at(swappedPixels),
	};
	checks.push(
		"invert/flash/fade use independent .46/.40 noncommuting color oracles",
	);
	const effects: readonly FinishingEffect[] = [
		...orderedFinishing,
		{ kind: "letterbox", amount: 1, heightFraction: 0.1 },
		{ kind: "quantizationDither", amount: 1 },
	];
	for (const alpha of [0, 0.5, 1]) {
		const baseline = await capture(finishingSource({ alpha }));
		for (const effect of effects) {
			const actual = await capture(
				finishingSource({
					alpha,
					post: [{ stage: "composite", effects: [effect] }],
				}),
			);
			for (let i = 3; i < actual.length; i += 4)
				check(
					actual[i] === baseline[i],
					`${effect.kind} changed alpha ${alpha} at ${i}`,
				);
		}
		const black = await capture(
			finishingSource({
				alpha,
				post: [{ stage: "composite", effects: [{ kind: "fade", amount: 1 }] }],
			}),
		);
		check(
			at(black)
				.slice(0, 3)
				.every((value) => value === 0),
			"fade=1 must blacken RGB",
		);
		check(at(black)[3] === at(baseline)[3], "fade=1 must not dissolve alpha");
	}
	checks.push(
		"all five finishing effects preserve alpha 0/.5/1; fade=1 is black, not transparent",
	);
	const letterbox = await capture(
		finishingSource({ post: [{ stage: "composite", effects: [effects[3]] }] }),
	);
	let blackRows = 0;
	for (let y = 0; y < 100; y++) {
		const expected = y < 10 || y >= 90 ? 0 : 51;
		if (!expected) blackRows++;
		for (let x = 0; x < 100; x++)
			check(
				at(letterbox, x, y).join() ===
					`${expected},${expected},${expected},255`,
				`Letterbox row ${y}, column ${x}`,
			);
	}
	observations.letterbox = {
		blackRows,
		firstInterior: at(letterbox, 50, 10),
		lastInterior: at(letterbox, 50, 89),
	};
	const fullBars = await capture(
		finishingSource({
			post: [
				{
					stage: "composite",
					effects: [{ kind: "letterbox", amount: 1, heightFraction: 0.5 }],
				},
			],
		}),
	);
	check(
		fullBars.every((value, index) => value === (index % 4 === 3 ? 255 : 0)),
		"Half-height bars must cover all rows",
	);
	checks.push(
		"100px height and per-side .1 letterbox produce exactly ten opaque black rows at each edge",
	);
	const base = await capture(finishingSource());
	for (const effect of effects) {
		const zero = await capture(
			finishingSource({
				post: [{ stage: "composite", effects: [{ ...effect, amount: 0 }] }],
			}),
		);
		check(
			(await digest(zero)) === (await digest(base)),
			`${effect.kind} amount=0 is not identity`,
		);
	}
	const grade: MvEffect = {
		kind: "grade",
		exposure: -1,
		contrast: 1,
		saturation: 1,
		lift: [0, 0, 0],
		gain: [1, 1, 1],
	};
	const ditherSource = finishingSource({
		post: [
			{
				stage: "composite",
				effects: [grade, { kind: "quantizationDither", amount: 1 }],
			},
		],
	});
	const dither = await capture(ditherSource),
		values = new Set<number>();
	let total = 0,
		nonPeriodic = 0;
	for (let y = 0; y < 100; y++)
		for (let x = 0; x < 100; x++) {
			const [r, g, b, a] = at(dither, x, y);
			check(
				(r === 25 || r === 26) && r === g && g === b && a === 255,
				`Dither float/shared-noise oracle at ${x},${y}: ${r},${g},${b},${a}`,
			);
			values.add(r);
			total += r;
			if (x < 96 && r !== at(dither, x + 4, y)[0]) nonPeriodic++;
		}
	check(
		values.size === 2,
		"Dither quantized 51*.5 before applying noise: expected both 25 and 26",
	);
	check(
		total / 10000 > 25.35 && total / 10000 < 25.65,
		`Biased dither mean ${total / 10000}`,
	);
	check(nonPeriodic > 100, "Dither is a repeating 4x4 Bayer palette pattern");
	const originalHash = await digest(dither);
	for (const frame of [11, 3, 0, 3])
		check(
			(await digest(await capture(ditherSource, frame))) === originalHash,
			"Fixed-seed dither varies with frame/order",
		);
	check(
		(await digest(await capture({ ...ditherSource, seed: 36 }))) !==
			originalHash,
		"Dither ignores seed",
	);
	observations.dither = {
		values: [...values].sort(),
		mean: total / 10000,
		nonPeriodic,
	};
	checks.push(
		"same float group retains 25.5 before seed-fixed RGB-shared dither; neither grain nor Bayer palette quantization",
	);
	observations.selectedRoles = await verifyFinishingRoles(
		ordered,
		orderedPixels,
	);
	checks.push(
		"role stage executes finishing; composite post cannot include or create coverage from output-excluded roles",
	);
	return { checks, observations };
}

import type { ProgrammaticSource } from "@opencut/editor-contracts";
import { at, assertGray, capture, check, digest } from "./mv-finishing-capture";
import {
	animatedFinishingSource,
	finishingSource,
} from "./mv-finishing-source";

export async function verifyFinishingAnimation() {
	const source = animatedFinishingSource(),
		observations: Record<string, number[]> = {};
	const expected: Record<number, number> = {
		0: 51,
		1: 51,
		2: 51,
		3: 60.5625,
		4: 89.25,
		5: 137.0625,
		6: 204,
		7: 165.75,
		8: 127.5,
		10: 70.125,
		11: 55.78125,
	};
	const hashes = new Map<number, string>();
	for (const frame of [11, 2, 6, 0, 8, 4, 3, 10, 5, 7, 1, 11, 4]) {
		const actual = await capture(source, frame);
		assertGray(actual, expected[frame], `Automation frame ${frame}`);
		observations[frame] = at(actual);
		const hash = await digest(actual),
			earlier = hashes.get(frame);
		check(
			!earlier || earlier === hash,
			`Random/repeated seek changed frame ${frame}`,
		);
		hashes.set(frame, hash);
	}
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
						input: "solid",
						timeMap: [
							{ atFrame: 0, sourceFrame: 11 },
							{ atFrame: 11, sourceFrame: 0 },
						],
					},
				},
			],
		},
	};
	const reloaded: ProgrammaticSource = JSON.parse(JSON.stringify(reversed));
	for (const frame of [11, 3, 8, 0, 3]) {
		check(
			(await digest(await capture(reloaded, frame))) === hashes.get(frame),
			`Outer finishing used ref-mapped clock at ${frame}`,
		);
	}
	const held = finishingSource({
		post: [
			{
				stage: "composite",
				effects: [{ kind: "invert", amount: 0.5 }],
				automation: [
					{
						effect: 0,
						keyframes: [
							{ frame: 2, value: 0, easing: "linear" },
							{ frame: 6, value: 1, easing: "linear" },
						],
					},
				],
			},
		],
	});
	assertGray(await capture(held, 0), 51, "First automation endpoint hold");
	assertGray(await capture(held, 11), 204, "Last automation endpoint hold");
	return {
		observations,
		checks: [
			"intensity curves use departing-point easing and held endpoints; frame=duration knot is accepted",
			"random/repeated seek and JSON round-trip retain exact pixels; outer finishing uses source frame through reverse ref",
		],
	};
}

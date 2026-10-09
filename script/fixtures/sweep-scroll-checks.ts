import type {
	ProgrammaticSource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
import type { GeneratorCapture } from "./generator-capture";
import { clearPixels } from "./generator-capture";
import { assertGenerator as assert } from "./generator-browser-assets";
import {
	scrollScene,
	sweepScene,
	sweepScrollSource,
} from "./sweep-scroll-fixture";
import {
	compareSweepScroll,
	scrollOracle,
	sweepOracle,
} from "./sweep-scroll-oracles";

export async function sweepScrollChecks(
	capture: GeneratorCapture,
	resources: ResolvedProgrammaticResource[],
	image: OffscreenCanvas,
) {
	const descriptors = resources.map((r) => r.resource);
	const sweep = sweepScene(),
		scroll = scrollScene();
	const sources = [
		sweepScrollSource(sweep, descriptors),
		sweepScrollSource(scroll, descriptors),
	];
	const images: Uint8ClampedArray[] = [],
		oracles = [];
	for (const frame of [0, 12, 24] as const) {
		const a = await capture(sources[0], frame),
			b = await capture(sources[1], frame);
		oracles.push({
			frame,
			ascii: compareSweepScroll(a.pixels, sweepOracle(frame), `ASCII ${frame}`),
			particle: compareSweepScroll(
				b.pixels,
				scrollOracle(image, frame),
				`Particle ${frame}`,
			),
		});
		images.push(a.pixels, b.pixels);
	}
	const rtl = sweepScrollSource(
		{ ...sweep, settings: { ...sweep.settings, direction: "rightToLeft" } },
		descriptors,
	);
	oracles.push({
		frame: 12,
		ascii: compareSweepScroll(
			(await capture(rtl, 12)).pixels,
			sweepOracle(12, "rightToLeft"),
			"ASCII RTL",
		),
		particle: undefined,
	});
	const temporal = [];
	for (const [index, source] of sources.entries()) {
		const hashes = new Map<number, string>();
		for (const frame of [0, 12, 24])
			hashes.set(frame, (await capture(source, frame)).hash);
		assert(
			new Set(hashes.values()).size === 3,
			`Generator ${index} endpoints/midpoint static`,
		);
		for (const frame of [24, 0, 12, 0, 24, 12])
			assert(
				(await capture(source, frame)).hash === hashes.get(frame),
				`Generator ${index} seek state`,
			);
		assert(
			(await capture(JSON.parse(JSON.stringify(source)), 12)).hash ===
				hashes.get(12),
			"JSON restore",
		);
		assert(
			(await capture(source, 0, { trim: 48000 })).hash === hashes.get(12),
			"Trim remapping",
		);
		assert(
			(
				await capture(
					{ ...source, frameRate: { numerator: 30000, denominator: 1001 } },
					12,
				)
			).hash === hashes.get(12),
			"Rational fps frame identity",
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
								{ atFrame: 0, sourceFrame: 24 },
								{ atFrame: 24, sourceFrame: 0 },
							],
						},
					},
				],
			},
		};
		for (const frame of [0, 12, 24])
			assert(
				(await capture(reversed, frame)).hash === hashes.get(24 - frame),
				"Ref frame remapping",
			);
		assert(
			clearPixels(
				(
					await capture(
						{
							...source,
							recipe: { ...source.recipe!, outputRoles: ["background"] },
						},
						12,
					)
				).pixels,
			),
			"Role filtering",
		);
		let rejected = false;
		try {
			await capture(source, 12, { resources: [] });
		} catch {
			rejected = true;
		}
		assert(rejected, "Missing resolved resource was accepted");
		temporal.push(Object.fromEntries(hashes));
	}
	const baseSweep = (await capture(sources[0], 12)).hash;
	const sweepVariants = [
		{ ...sweep.settings, textB: "XXXXXXXXXXXX\nYYYYYYYYYYYY" },
		{ ...sweep.settings, bandWidth: 0.6 },
		{ ...sweep.settings, opacity: 0.4 },
		{ ...sweep.settings, direction: "rightToLeft" as const },
		{ ...sweep.settings, activeColor: [0, 1, 1, 1] as const },
	];
	for (const settings of sweepVariants)
		assert(
			(
				await capture(
					sweepScrollSource({ ...sweep, settings }, descriptors),
					12,
				)
			).hash !== baseSweep,
			"ASCII parameter had no effect",
		);
	const seeded = sweepScrollSource(
		{
			...sweep,
			settings: { ...sweep.settings, glyphs: "0123456789ABCDEF", bandWidth: 1 },
		},
		descriptors,
	);
	assert(
		(await capture(seeded, 12)).hash !==
			(await capture({ ...seeded, seed: 97 }, 12)).hash,
		"ASCII seed had no effect",
	);
	const baseScroll = (await capture(sources[1], 12)).hash;
	for (const settings of [
		{ ...scroll.settings, band: 0.2 },
		{ ...scroll.settings, scatter: 0.8 },
		{ ...scroll.settings, spin: 1 },
		{ ...scroll.settings, opacity: 0.4 },
		{ ...scroll.settings, columns: 8 },
		...(["right-to-left", "top-to-bottom", "bottom-to-top"] as const).map(
			(direction) => ({ ...scroll.settings, direction }),
		),
	])
		assert(
			(
				await capture(
					sweepScrollSource({ ...scroll, settings }, descriptors),
					12,
				)
			).hash !== baseScroll,
			"Particle parameter had no effect",
		);
	const scattered = sweepScrollSource(
		{ ...scroll, settings: { ...scroll.settings, scatter: 0.8, spin: 1 } },
		descriptors,
	);
	assert(
		(await capture(scattered, 12)).hash !==
			(await capture({ ...scattered, seed: 97 }, 12)).hash,
		"Particle seed had no effect",
	);
	const half = (await capture(sources[1], 12)).pixels,
		start = (await capture(sources[1], 0)).pixels;
	let detached = 0,
		intact = 0,
		holes = 0,
		partial = 0;
	for (let y = 0; y < 108; y++)
		for (let x = 0; x < 192; x++) {
			const i = (y * 192 + x) * 4;
			if (x >= 147 && start[i + 3] > 0) {
				intact++;
				assert(
					Math.abs(half[i + 3] - start[i + 3]) <= 1,
					"Intact-side alpha changed",
				);
			}
			if (x < 48) {
				holes++;
				assert(half[i + 3] === 0, "Cleared column retained image");
			}
			if (x >= 50 && x < 140 && half[i + 3] > 0) detached++;
			if (half[i + 3] > 0 && half[i + 3] < 255) partial++;
		}
	assert(
		detached > 300 && intact > 500 && holes > 1000 && partial > 500,
		"Particle geometry/alpha fixture lacked coverage",
	);
	return {
		sources,
		images,
		evidence: {
			oracles,
			temporal,
			parameterChecks: sweepVariants.length + 8,
			seedChecks: 2,
			particleRegions: { detached, intact, holes, partial },
		},
	};
}

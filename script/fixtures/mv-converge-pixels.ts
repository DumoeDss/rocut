import type { ProgrammaticSource } from "@opencut/editor-contracts";
import type {
	MvConvergePlan,
	MvConvergeCommand,
	MvConvergeStyle,
} from "../../packages/editor-contracts/src/mv-converge-plan";
import type { ConvergeReference } from "./mv-converge-reference-contract";
import { createConvergeReference } from "./mv-converge-reference-browser";
import {
	convergeSource,
	convergeSettings,
	CONVERGE_BEATS,
	CONVERGE_START,
	CONVERGE_WHITE_AT,
} from "./mv-converge-source";
import { captureConverge, check, difference } from "./mv-converge-capture";
import { display } from "./mv-type-card-pixels";
import { createConvergeDiagnostics } from "./mv-converge-diagnostics";

export type ConvergeOracle = Awaited<
	ReturnType<typeof createConvergeReference>
>;
export async function originalConvergePixels(
	oracle: ConvergeOracle,
	source: ProgrammaticSource,
	index: number,
	overrides: { seed?: number; grain?: number; whiteAt?: number } = {},
) {
	const result = await oracle.render({
		time:
			CONVERGE_START +
			(index * source.frameRate.denominator) / source.frameRate.numerator,
		shotStart: CONVERGE_START,
		duration:
			(source.durationFrames * source.frameRate.denominator) /
			source.frameRate.numerator,
		args: {
			seed: overrides.seed ?? 7,
			grain: overrides.grain ?? 0.07,
			whiteAt: overrides.whiteAt ?? CONVERGE_WHITE_AT,
		},
	});
	try {
		const image = new OffscreenCanvas(source.width, source.height),
			ctx = image.getContext("2d")!;
		try {
			ctx.drawImage(result.bitmap, 0, 0, source.width, source.height);
			return {
				pixels: ctx.getImageData(0, 0, source.width, source.height).data,
				provenance: result.provenance,
			};
		} finally {
			image.width = image.height = 1;
		}
	} finally {
		result.bitmap.close();
		result.canvas.width = result.canvas.height = 1;
	}
}
const colorIs = (style: MvConvergeStyle, r: number, g: number, b: number) =>
	style.kind === "solid" &&
	Math.abs(style.color[0] - r / 255) < 1e-9 &&
	Math.abs(style.color[1] - g / 255) < 1e-9 &&
	Math.abs(style.color[2] - b / 255) < 1e-9;
const omit =
	(test: (command: MvConvergeCommand) => boolean) => (plan: MvConvergePlan) =>
		Reflect.set(
			plan,
			"commands",
			plan.commands.filter((command) => !test(command)),
		);

type ComparisonRecorder = (
	label: string,
	source: ProgrammaticSource,
	index: number,
	actual: Uint8ClampedArray,
	expected: Awaited<ReturnType<typeof originalConvergePixels>>,
	oracle?: ConvergeOracle,
) => Promise<void>;

export async function verifyConvergePixels(
	reference: ConvergeReference,
	diagnosticOnly = false,
) {
	const source = convergeSource(),
		oracle = await createConvergeReference({
			reference,
			beats: CONVERGE_BEATS,
		});
	const observations: Record<string, unknown> = {},
		provenance: unknown[] = [];
	const violations: string[] = [],
		diagnostic = createConvergeDiagnostics();
	const record: ComparisonRecorder = async (
		label,
		source,
		index,
		actual,
		expected,
		selectedOracle = oracle,
	) => {
		const error = difference(actual, expected.pixels);
		observations[label] = error;
		if (error.max > 2 || error.mae >= 0.025) {
			if (!violations.includes(label)) violations.push(label);
			observations[label] = {
				...error,
				diagnostic: await diagnostic({
					label,
					source,
					index,
					actual,
					expected: expected.pixels,
					oracle: selectedOracle,
					originalFrame: expected.provenance,
				}),
			};
		}
	};
	const progress = {
		stage: "pixels",
		current: "start",
		observations,
		provenance,
		violations,
	};
	Reflect.set(globalThis, "__mvConvergeProgress", progress);
	try {
		let repeated: Uint8ClampedArray | undefined;
		// Include both sides of real beats, 24Hz grain boundaries, inward late-stage
		// particles and the original white-out timings; no frames selected by error.
		for (const index of diagnosticOnly
			? [120, 0, 30, 96, 162, 190, 203, 209, 210]
			: [
					120, 0, 1, 2, 3, 29, 30, 31, 95, 96, 97, 162, 189, 190, 195, 202, 203,
					209, 210, 211, 239, 120,
				]) {
			progress.current = `original/${index}`;
			const actual = await captureConverge(source, index),
				expected = await originalConvergePixels(oracle, source, index);
			await record(`original-${index}`, source, index, actual, expected);
			display(actual, expected.pixels, `converge frame ${index}`);
			if (index === 120) {
				if (repeated)
					check(
						difference(actual, repeated).max === 0,
						"Converge repeated/reversed seek nondeterministic",
					);
				repeated = actual;
			}
			if ([0, 30, 190, 210].includes(index))
				provenance.push(expected.provenance);
		}
		if (diagnosticOnly)
			return {
				passed: violations.length === 0,
				diagnosticOnly: true,
				violations,
				observations,
				provenance,
				thresholds: { maxChannel: 2, rgbaMaeLessThan: 0.025 },
				checks: [
					"Fixed diagnostic frame matrix; not the complete acceptance suite",
				],
			};
		const base = repeated!;
		check(
			difference(base, await captureConverge(source, 120, 30)).max === 0,
			"Converge trim changed source time",
		);
		const reversed = structuredClone(source);
		Reflect.set(reversed.recipe!, "root", "reverse");
		(reversed.recipe!.nodes as unknown[]).push({
			id: "reverse",
			scene: {
				kind: "ref",
				input: "converge",
				timeMap: [
					{ atFrame: 0, sourceFrame: 239 },
					{ atFrame: 239, sourceFrame: 0 },
				],
			},
		});
		check(
			difference(base, await captureConverge(reversed, 119)).max === 0,
			"Converge ref did not remap scene/beat clock",
		);
		const hidden = structuredClone(source);
		Reflect.set(hidden.recipe!, "outputRoles", ["subject"]);
		check(
			(await captureConverge(hidden, 120)).every((value) => value === 0),
			"Converge excluded role leaked pixels",
		);
		const wrongClock = difference(
			base,
			(await originalConvergePixels(oracle, source, 150)).pixels,
		);
		check(wrongClock.mae > 0.5, "Converge wrong-clock control invisible");
		observations["negative-clock"] = wrongClock;
		const controls: readonly [
			string,
			number,
			(plan: MvConvergePlan) => void,
		][] = [
			["grain", 120, omit((c) => c.kind === "grain")],
			[
				"arms",
				120,
				omit(
					(c) =>
						c.kind === "path" &&
						c.paints.some((p) => p.kind === "stroke" && p.width === 90),
				),
			],
			[
				"rings",
				45,
				omit(
					(c) => c.kind === "path" && c.path.some((p) => p.kind === "ellipse"),
				),
			],
			[
				"ribbons",
				120,
				omit(
					(c) =>
						c.kind === "path" &&
						c.paints.some(
							(p) =>
								p.kind === "stroke" &&
								p.composite === "source-over" &&
								colorIs(p.style, 200, 55, 58),
						),
				),
			],
			[
				"glass",
				120,
				omit(
					(c) =>
						c.kind === "path" &&
						c.paints.some(
							(p) => p.kind === "fill" && p.style.kind === "linear",
						),
				),
			],
			[
				"fireflies",
				120,
				omit(
					(c) =>
						c.kind === "rect" &&
						c.paint.style.kind === "radial" &&
						c.paint.style.stops.some(
							(s) =>
								Math.abs(s.color[0] - 242 / 255) < 1e-9 &&
								Math.abs(s.color[1] - 1) < 1e-9,
						),
				),
			],
			[
				"additive-paths",
				162,
				omit(
					(c) =>
						c.kind === "path" &&
						c.paints.some((p) => p.composite === "lighter"),
				),
			],
			[
				"white-out",
				209,
				omit((c) =>
					c.kind === "path"
						? c.paints.some((p) => colorIs(p.style, 255, 248, 238))
						: c.kind === "rect" && colorIs(c.paint.style, 255, 248, 238),
				),
			],
		];
		for (const [label, index, mutate] of controls) {
			progress.current = `negative/${label}/${index}`;
			const error = difference(
				await captureConverge(source, index),
				await captureConverge(source, index, 0, mutate),
			);
			observations[`negative-${label}`] = error;
			check(
				error.changed > 100 && error.mae > 0.002,
				`Converge ${label} negative control invisible: ${JSON.stringify(error)}`,
			);
		}
		const shifted = structuredClone(source);
		Reflect.set(shifted, "seed", 10);
		const seeded = await captureConverge(shifted, 120),
			seededExpected = await originalConvergePixels(oracle, shifted, 120, {
				seed: 17,
			});
		await record("seed", shifted, 120, seeded, seededExpected);
		check(
			difference(base, seeded).mae > 0.2,
			"Converge seed author edit did not change pixels",
		);
		const laterWhite = convergeSettings();
		Reflect.set(laterWhite, "whiteAtTicks", 17 * 120000);
		const laterSource = convergeSource(laterWhite);
		for (const index of [210, 239]) {
			progress.current = `white-after-span/${index}`;
			const actual = await captureConverge(laterSource, index),
				expected = await originalConvergePixels(oracle, laterSource, index, {
					whiteAt: 17,
				});
			await record(
				`white-after-span-${index}`,
				laterSource,
				index,
				actual,
				expected,
			);
			check(
				difference(actual, await captureConverge(source, index)).mae > 1,
				"Post-span white boundary silently clamped to clip end",
			);
		}
		const boundaries = convergeSource();
		Reflect.set(boundaries, "frameRate", { numerator: 100, denominator: 1 });
		Reflect.set(boundaries, "durationFrames", 400);
		Reflect.set(boundaries.recipe!.nodes[0]!.scene, "span", {
			startFrame: 0,
			durationFrames: 400,
		});
		for (const index of [315, 316, 317, 337, 338, 339, 349, 350, 351]) {
			progress.current = `exact-white-boundary-100fps/${index}`;
			const actual = await captureConverge(boundaries, index),
				expected = await originalConvergePixels(oracle, boundaries, index);
			await record(
				`white-boundary-${index}`,
				boundaries,
				index,
				actual,
				expected,
			);
		}
		const fractional = structuredClone(source);
		Reflect.set(fractional, "frameRate", {
			numerator: 30000,
			denominator: 1001,
		});
		for (const index of [30, 94, 105]) {
			progress.current = `fractional/${index}`;
			const actual = await captureConverge(fractional, index),
				expected = await originalConvergePixels(oracle, fractional, index);
			await record(`fractional-${index}`, fractional, index, actual, expected);
			check(
				difference(actual, await captureConverge(fractional, index, 10)).max ===
					0,
				"Fractional converge trim mismatch",
			);
		}
		await verifySparseBeats(reference, observations, progress, record);
		await verifySmallComposition(observations);
		return {
			passed: violations.length === 0,
			violations,
			thresholds: { maxChannel: 2, rgbaMaeLessThan: 0.025 },
			observations,
			provenance,
			checks: [
				"Complete original converge scene at 1920x1080 with unmodified util.js makeClock, explicit beats, beat/grain/white-out boundaries, reverse/repeat/ref/trim and rational fps",
				"All scene mechanisms rendered; independent wrong-clock and removed grain/arms/rings/ribbons/glass/firefly/additive/white-out controls",
				"Original sparse/empty beat extrapolation versus real-beat pulse; source+scene seed; small-canvas role/composite post and authored palette",
			],
		};
	} finally {
		oracle.dispose();
	}
}

async function verifySparseBeats(
	reference: ConvergeReference,
	observations: Record<string, unknown>,
	progress: { current: string },
	record: ComparisonRecorder,
) {
	for (const beats of [[], [12.2], [12.2, 12.75]]) {
		const settings = convergeSettings();
		Reflect.set(settings, "beats", {
			kind: "manual",
			songTicks: beats.map((beat) => Math.round(beat * 120000)),
		});
		const source = convergeSource(settings),
			oracle = await createConvergeReference({ reference, beats });
		try {
			for (const index of [30, 120, 195]) {
				progress.current = `sparse-${beats.length}/${index}`;
				const actual = await captureConverge(source, index),
					expected = await originalConvergePixels(oracle, source, index);
				await record(
					`sparse-${beats.length}-${index}`,
					source,
					index,
					actual,
					expected,
					oracle,
				);
				observations[`sparse-${beats.length}-${index}-clock`] =
					expected.provenance.clock;
				if (!beats.length)
					check(
						expected.provenance.clock.pulse8 === 0,
						"Empty-beat oracle fabricated clock pulses",
					);
			}
		} finally {
			oracle.dispose();
		}
	}
}

async function verifySmallComposition(observations: Record<string, unknown>) {
	const source = convergeSource();
	Reflect.set(source, "width", 384);
	Reflect.set(source, "height", 216);
	const original = await captureConverge(source, 120);
	check(
		original.some((value, index) => index % 4 !== 3 && value > 50),
		"Small converge is empty",
	);
	const graded = structuredClone(source);
	Reflect.set(graded.recipe!, "post", [
		{ roles: ["graphics"], effects: [{ kind: "fade", amount: 0.5 }] },
	]);
	const actual = await captureConverge(graded, 120);
	let alphaError = 0,
		colorError = 0;
	for (let i = 0; i < actual.length; i += 4) {
		alphaError = Math.max(
			alphaError,
			Math.abs(actual[i + 3]! - original[i + 3]!),
		);
		for (let c = 0; c < 3; c++)
			colorError = Math.max(
				colorError,
				Math.abs(actual[i + c]! - original[i + c]! * 0.5),
			);
	}
	check(
		alphaError === 0 && colorError <= 1,
		"Converge role post failed alpha-preserving fade",
	);
	Reflect.set(graded.recipe!, "post", [
		{ stage: "composite", effects: [{ kind: "fade", amount: 0.5 }] },
	]);
	check(
		difference(actual, await captureConverge(graded, 120)).max === 0,
		"Converge role/composite fade disagree",
	);
	Reflect.set(graded.recipe!, "post", [
		{ roles: ["foreground"], effects: [{ kind: "fade", amount: 0.5 }] },
	]);
	check(
		difference(original, await captureConverge(graded, 120)).max === 0,
		"Converge post affected unrelated role",
	);
	const edited = convergeSettings();
	Reflect.set(edited.palette, "verm", [0.1, 0.8, 1, 1]);
	const variant = convergeSource(edited);
	Reflect.set(variant, "width", 384);
	Reflect.set(variant, "height", 216);
	check(
		difference(original, await captureConverge(variant, 120)).mae > 0.1,
		"Converge author palette ignored",
	);
	const clearAlpha = (value: unknown): void => {
		if (Array.isArray(value)) {
			if (value.length === 4 && value.every((item) => typeof item === "number"))
				value[3] = 0;
			else value.forEach(clearAlpha);
		} else if (value && typeof value === "object")
			Object.values(value).forEach(clearAlpha);
	};
	const transparentSettings = convergeSettings();
	clearAlpha(transparentSettings.palette);
	Reflect.set(transparentSettings, "grain", 0);
	const transparent = convergeSource(transparentSettings);
	Reflect.set(transparent, "width", 384);
	Reflect.set(transparent, "height", 216);
	for (const index of [120, 211])
		check(
			(await captureConverge(transparent, index)).every((value) => value === 0),
			`Transparent authored palette/grain0 exposed hidden color at ${index}`,
		);
	observations.composition = {
		width: 384,
		height: 216,
		alphaError,
		colorError,
		allPaletteAlphaZeroWithGrainZero: [120, 211],
		exported: false,
	};
}

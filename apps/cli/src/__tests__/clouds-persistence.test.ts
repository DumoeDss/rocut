import { expect, test } from "bun:test";
import type {
	EditingChannel,
	ProgrammaticResource,
	ProgrammaticSource,
} from "@opencut/editor-contracts";
import { withCloudsHost } from "./clouds-persistence-support";

const controls = {
	amount: 0.75,
	density: 0.625,
	scale: 0.25,
	speed: 0.125,
	windX: -0.375,
	windY: 0.5,
	refraction: 0.015625,
	fogOpacity: 0.5,
	colorR: 0.25,
	colorG: 0.5,
	colorB: 0.75,
	seed: 41,
};
const bounds = {
	amount: [0, 1],
	density: [0, 1],
	scale: [0.05, 2],
	speed: [0, 4],
	windX: [-16, 16],
	windY: [-16, 16],
	refraction: [0, 0.08],
	fogOpacity: [0, 1],
	colorR: [0, 1],
	colorG: [0, 1],
	colorB: [0, 1],
	seed: [0, 65535],
};
const animated = {
	amount: [0.25, 0.75],
	density: [0.25, 0.75],
	windX: [-1.25, 0.75],
	windY: [0.375, -0.5],
	refraction: [0.015625, 0.0625],
	fogOpacity: [0.5, 0.25],
	colorR: [0.75, 0.25],
	colorG: [0.25, 0.5],
	colorB: [0.5, 0.75],
};
const channel = (key: string, values: readonly number[]): EditingChannel => ({
	keys: values.map((value, index) => ({
		id: `${key}-${index}`,
		time: index * 24000,
		value,
		segmentToNext: "linear",
		tangentMode: "auto",
	})),
});
const animations = Object.fromEntries(
	Object.entries(animated).map(([key, values]) => [
		`effects.cloud.params.${key}`,
		channel(key, values),
	]),
);
const variants = [
	{ id: "clouds-attached", layer: false, kind: "graphic" },
	{ id: "clouds-layer", layer: true, kind: "effect" },
];
const sourceFor = (image: ProgrammaticResource): ProgrammaticSource => ({
	version: 1,
	runtime: "canvas-worker",
	code: "",
	width: 96,
	height: 64,
	durationFrames: 30,
	frameRate: { numerator: 30, denominator: 1 },
	seed: 97,
	resources: [image],
	recipe: {
		version: 1,
		root: "shot",
		songStartSeconds: 0,
		outputRoles: ["background", "subject", "graphics", "foreground"],
		nodes: [
			{
				id: "shot",
				scene: {
					kind: "illust",
					sprites: [],
					easing: "linear",
					motion: { startFrame: 0, durationFrames: 29 },
					background: {
						image: image.id,
						from: { x: 0.5, y: 0.5, zoom: 1 },
						to: { x: 0.5, y: 0.5, zoom: 1 },
					},
				},
			},
		],
	},
});
const editing = (
	source: ProgrammaticSource,
	layer: boolean,
	params: Record<string, unknown>,
	channels: Record<string, EditingChannel> = layer ? {} : animations,
) =>
	layer
		? {
				type: "effect",
				name: "Clouds layer",
				effectType: "clouds",
				params,
				...(Object.keys(channels).length ? { animations: channels } : {}),
			}
		: {
				type: "graphic",
				definitionId: "programmatic",
				name: "Clouds image",
				params: {},
				programmatic: source,
				effects: [{ id: "cloud", type: "clouds", enabled: true, params }],
				animations: channels,
			};
const createClip = (
	id: string,
	trackId: string,
	payload: unknown,
	startTime = 12000,
) => ({
	kind: "create-clip",
	clip: {
		id,
		trackId,
		startTime,
		duration: 120000,
		trimStart: 0,
		trimEnd: 0,
		editing: payload,
	},
});

test("Clouds real Host persists twelve controls and nine attached channels; invalid batches do not change memory or disk", async () => {
	await withCloudsHost(async (fixture) => {
		const catalog = await fixture.catalog();
		expect(catalog.effects.clouds).toBeArray();
		expect(catalog.effects.clouds.map((field) => field.key).sort()).toEqual(
			Object.keys(controls).sort(),
		);
		expect(
			catalog.effects.clouds
				.filter((field) => field.keyframable)
				.map((field) => field.key)
				.sort(),
		).toEqual(Object.keys(animated).sort());
		const resource = await fixture.importImage();
		const source = sourceFor(resource);
		await fixture.accept([
			...variants.flatMap((variant) => [
				{
					kind: "create-track",
					track: {
						id: `track-${variant.id}`,
						name: variant.id,
						kind: variant.kind,
						hidden: false,
					},
				},
				createClip(
					variant.id,
					`track-${variant.id}`,
					editing(source, variant.layer, controls),
				),
			]),
			{
				kind: "create-track",
				track: {
					id: "sentinel-track",
					name: "Sentinel",
					kind: "text",
					hidden: false,
				},
			},
			createClip("sentinel", "sentinel-track", {
				type: "text",
				name: "Untouched",
				params: { content: "Sentinel" },
			}),
		]);
		const assertControls = async (
			params: Record<string, number>,
			channels = animations,
		) => {
			const { clips } = await fixture.snapshot();
			for (const variant of variants)
				expect<unknown>(
					clips.find((clip) => clip.id === variant.id)?.editing,
				).toEqual(
					editing(source, variant.layer, params, variant.layer ? {} : channels),
				);
			const attached = clips.find(
				(clip) => clip.id === "clouds-attached",
			)!.editing!;
			expect(attached.programmatic).toEqual(source);
			expect(attached.programmatic!.seed).toBe(97);
			expect(attached.effects![0].params.seed).toBe(params.seed);
			expect(attached.programmatic!.resources).toEqual([resource]);
		};
		await assertControls(controls);
		await fixture.makeAuthorUnavailable();
		await fixture.reopen(
			"created all twelve controls and nine attached animated channels",
		);
		await fixture.assertResource(resource);
		const update = (params: Record<string, number>, channels = animations) =>
			variants.map((variant) => ({
				kind: "update-clip",
				clipId: variant.id,
				patch: {
					editing: editing(
						source,
						variant.layer,
						params,
						variant.layer ? {} : channels,
					),
				},
			}));
		for (const [label, params] of [
			[
				"inclusive lower bounds including amount/density/speed zero",
				Object.fromEntries(
					Object.entries(bounds).map(([key, values]) => [key, values[0]]),
				),
			],
			[
				"inclusive upper bounds",
				Object.fromEntries(
					Object.entries(bounds).map(([key, values]) => [key, values[1]]),
				),
			],
			["restored nondefault controls", controls],
		] as const) {
			await fixture.accept(update(params));
			await assertControls(params);
			await fixture.reopen(label);
		}
		const before = await fixture.snapshot();
		for (const variant of variants) {
			const reject = (params: Record<string, unknown>, label: string) =>
				fixture.reject(
					variant.id,
					editing(source, variant.layer, params),
					`${variant.id}: ${label}`,
				);
			for (const [key, [minimum, maximum]] of Object.entries(bounds)) {
				for (const value of [minimum - 0.001, maximum + 0.001])
					await reject({ ...controls, [key]: value }, `${key} range ${value}`);
				for (const value of ["1", null, true])
					await reject(
						{ ...controls, [key]: value },
						`${key} invalid type ${value}`,
					);
				const missing: Record<string, unknown> = { ...controls };
				delete missing[key];
				await reject(missing, `missing ${key} static fallback`);
			}
			await reject({ ...controls, seed: 1.5 }, "seed must be integer");
			await reject({ ...controls, typo: 1 }, "unknown parameter");
			for (const identity of [
				{ amount: 0 },
				{ density: 0 },
				{ refraction: 0, fogOpacity: 0 },
			])
				for (const invalid of [
					{ seed: 1.5 },
					{ scale: 0 },
					{ speed: 5 },
					{ typo: 1 },
				])
					await reject(
						{ ...controls, ...identity, ...invalid },
						`identity cannot bypass ${JSON.stringify({ ...identity, ...invalid })}`,
					);
		}
		for (const [key, values] of Object.entries(animated)) {
			const [minimum, maximum] = bounds[key as keyof typeof bounds];
			for (const value of [minimum - 0.001, maximum + 0.001])
				await fixture.reject(
					"clouds-attached",
					editing(source, false, controls, {
						...animations,
						[`effects.cloud.params.${key}`]: channel(key, [values[0], value]),
					}),
					`attached animated ${key} range ${value}`,
				);
		}
		for (const key of Object.keys(controls).filter((key) => !(key in animated)))
			await fixture.reject(
				"clouds-attached",
				editing(source, false, controls, {
					...animations,
					[`effects.cloud.params.${key}`]: channel(key, [
						controls[key as keyof typeof controls],
					]),
				}),
				`attached static ${key} animation`,
				"not keyframable",
			);
		await fixture.reject(
			"clouds-attached",
			editing(source, false, controls, {
				...animations,
				"effects.cloud.params.typo": channel("typo", [1]),
			}),
			"attached unknown animation",
		);
		for (const key of Object.keys(controls))
			await fixture.reject(
				"clouds-layer",
				editing(source, true, controls, {
					[key]: channel(key, [controls[key as keyof typeof controls]]),
				}),
				`layer ${key} animation is unsupported`,
				"effect-layer renderer does not animate",
			);
		for (const identity of [
			{ amount: 0 },
			{ density: 0 },
			{ refraction: 0, fogOpacity: 0 },
		])
			for (const variant of variants)
				await fixture.reject(
					variant.id,
					editing(
						source,
						variant.layer,
						{ ...controls, ...identity },
						{
							[variant.layer ? "seed" : "effects.cloud.params.seed"]: channel(
								"seed",
								[1, 2],
							),
						},
					),
					`${variant.id}: identity does not bypass static animation rejection`,
				);
		expect(await fixture.snapshot()).toEqual(before);
		await fixture.reopen(
			"all invalid transactions preserved project bytes and revision",
		);
		const changed = {
			amount: 0.5,
			density: 0.75,
			scale: 0.5,
			speed: 0,
			windX: 1.25,
			windY: -0.75,
			refraction: 0.03125,
			fogOpacity: 0.75,
			colorR: 0.75,
			colorG: 0.25,
			colorB: 0.5,
			seed: 65535,
		};
		const reversed = Object.fromEntries(
			Object.entries(animated).map(([key, values]) => [
				`effects.cloud.params.${key}`,
				channel(key, [...values].reverse()),
			]),
		);
		await fixture.accept(update(changed, reversed));
		await assertControls(changed, reversed);
		const after = await fixture.snapshot();
		expect(after.clips.find((clip) => clip.id === "sentinel")).toEqual(
			before.clips.find((clip) => clip.id === "sentinel"),
		);
		expect(after.tracks).toEqual(before.tracks);
		await fixture.reopen(
			"updated every static control and every attached animated channel",
		);
		await fixture.assertResource(resource);
	});
}, 60000);

import { expect, test } from "bun:test";
import type {
	EditingChannel,
	ProgrammaticResource,
	ProgrammaticSource,
} from "@opencut/editor-contracts";
import { withDropletsHost } from "./droplets-persistence-support";

const controls = {
	amount: 0.75,
	count: 32,
	radius: 0.03125,
	speed: 0.5,
	elongation: 2,
	refraction: 0.015625,
	highlight: 0.25,
	seed: 41,
};
const bounds = {
	amount: [0, 1],
	count: [0, 64],
	radius: [0.003, 0.15],
	speed: [0, 4],
	elongation: [1, 4],
	refraction: [0, 0.1],
	highlight: [0, 1],
	seed: [0, 65535],
};
const optical = {
	amount: [0.25, 0.75],
	refraction: [0.015625, 0.0625],
	highlight: [0.5, 0.25],
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
	Object.entries(optical).map(([key, values]) => [
		`effects.water.params.${key}`,
		channel(key, values),
	]),
);
const variants = [
	{ id: "droplets-attached", layer: false, kind: "graphic" },
	{ id: "droplets-layer", layer: true, kind: "effect" },
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
				name: "Droplets layer",
				effectType: "droplets",
				params,
				...(Object.keys(channels).length ? { animations: channels } : {}),
			}
		: {
				type: "graphic",
				definitionId: "programmatic",
				name: "Droplets image",
				params: {},
				programmatic: source,
				effects: [{ id: "water", type: "droplets", enabled: true, params }],
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

test("Droplets real Host persists eight controls and attached optical animation; invalid batches do not change memory or disk", async () => {
	await withDropletsHost(async (fixture) => {
		const catalog = await fixture.catalog();
		expect(catalog.effects.droplets).toBeArray();
		expect(catalog.effects.droplets.map((field) => field.key).sort()).toEqual(
			Object.keys(controls).sort(),
		);
		expect(
			catalog.effects.droplets
				.filter((field) => field.keyframable)
				.map((field) => field.key)
				.sort(),
		).toEqual(Object.keys(optical).sort());
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
				(clip) => clip.id === "droplets-attached",
			)!.editing!;
			expect(attached.programmatic).toEqual(source);
			expect(attached.programmatic!.seed).toBe(97);
			expect(attached.effects![0].params.seed).toBe(params.seed);
			expect(attached.programmatic!.resources).toEqual([resource]);
		};
		await assertControls(controls);
		await fixture.makeAuthorUnavailable();
		await fixture.reopen(
			"created all eight controls and three attached optical channels",
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
				"inclusive lower bounds including amount/count/speed zero",
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
			for (const key of ["count", "seed"])
				await reject({ ...controls, [key]: 1.5 }, `${key} must be integer`);
			await reject({ ...controls, typo: 1 }, "unknown parameter");
			for (const identity of [{ amount: 0 }, { count: 0 }])
				for (const invalid of [
					{ seed: 1.5 },
					{ radius: 0 },
					{ speed: 5 },
					{ typo: 1 },
				])
					await reject(
						{ ...controls, ...identity, ...invalid },
						`identity cannot bypass ${JSON.stringify({ ...identity, ...invalid })}`,
					);
		}
		for (const [key, values] of Object.entries(optical)) {
			const [minimum, maximum] = bounds[key as keyof typeof bounds];
			for (const value of [minimum - 0.001, maximum + 0.001])
				await fixture.reject(
					"droplets-attached",
					editing(source, false, controls, {
						...animations,
						[`effects.water.params.${key}`]: channel(key, [values[0], value]),
					}),
					`attached animated ${key} range ${value}`,
				);
		}
		for (const key of Object.keys(controls).filter((key) => !(key in optical)))
			await fixture.reject(
				"droplets-attached",
				editing(source, false, controls, {
					...animations,
					[`effects.water.params.${key}`]: channel(key, [
						controls[key as keyof typeof controls],
					]),
				}),
				`attached static ${key} animation`,
				"not keyframable",
			);
		await fixture.reject(
			"droplets-attached",
			editing(source, false, controls, {
				...animations,
				"effects.water.params.typo": channel("typo", [1]),
			}),
			"attached unknown animation",
		);
		for (const key of Object.keys(controls))
			await fixture.reject(
				"droplets-layer",
				editing(source, true, controls, {
					[key]: channel(key, [controls[key as keyof typeof controls]]),
				}),
				`layer ${key} animation is unsupported`,
				"effect-layer renderer does not animate",
			);
		for (const identity of [{ amount: 0 }, { count: 0 }])
			for (const variant of variants)
				await fixture.reject(
					variant.id,
					editing(
						source,
						variant.layer,
						{ ...controls, ...identity },
						{
							[variant.layer ? "seed" : "effects.water.params.seed"]: channel(
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
			count: 12,
			radius: 0.0625,
			speed: 0,
			elongation: 3,
			refraction: 0.03125,
			highlight: 0.75,
			seed: 65535,
		};
		const reversed = Object.fromEntries(
			Object.entries(optical).map(([key, values]) => [
				`effects.water.params.${key}`,
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
			"updated every static control and every attached optical channel",
		);
		await fixture.assertResource(resource);
	});
}, 60000);

import { expect, test } from "bun:test";
import { revisionOf } from "@opencut/editor-contracts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { startHost } from "../host";
import { TargetRegistry } from "../target-registry";

const controls = {
	amount: 1,
	displacement: 0.075,
	cellSize: 12.75,
	dispersion: 0.08,
	seed: 37,
	centerX: 0.5,
	centerY: 0.5,
	radius: 0.4,
	feather: 0.15,
};
const bounds = {
	amount: [0, 1],
	displacement: [-0.25, 0.25],
	cellSize: [4, 256],
	dispersion: [0, 0.1],
	seed: [0, 65535],
	centerX: [-1, 2],
	centerY: [-1, 2],
	radius: [0, 2],
	feather: [0, 1],
};
const channel = (key: string, values: number[]) => ({
	keys: values.map((value, index) => ({
		id: `${key}-${index}`,
		time: index * 120000,
		value,
		segmentToNext: "linear",
		tangentMode: "auto",
	})),
});
const animations = Object.fromEntries(
	Object.entries({
		centerX: [0.2, 0.8],
		centerY: [0.35, 0.65],
		displacement: [-0.02, 0.08],
		cellSize: [8.5, 32.25],
	}).map(([key, values]) => [
		`effects.distortion.params.${key}`,
		channel(key, values),
	]),
);
const variants = [
	{ id: "displaced-clip", layer: false, kind: "text" },
	{ id: "displaced-layer", layer: true, kind: "effect" },
];
const editing = (
	layer: boolean,
	params: Record<string, unknown>,
	channels = animations,
) =>
	layer
		? {
				type: "effect",
				name: "Displacement",
				effectType: "displacement",
				params,
			}
		: {
				type: "text",
				name: "Displaced title",
				params: { content: "Displacement fixture" },
				effects: [
					{ id: "distortion", type: "displacement", enabled: true, params },
				],
				animations: channels,
			};

test("Displacement effects persist and reject invalid authoring atomically across Host restart", async () => {
	const parent = resolve(tmpdir());
	const root = await mkdtemp(join(parent, "rocut-displacement-reopen-"));
	const options = {
		projectRoot: join(root, "project"),
		registry: new TargetRegistry(join(root, "registry")),
		htmlBrowserExecutable: "",
		htmlFrameConnectionFile: "",
	};
	let host = await startHost(options);
	let revision = 0;
	const post = (operations: unknown[]) =>
		fetch(new URL("api/apply", host.editorUrl), {
			method: "POST",
			body: JSON.stringify({ expectedRevision: revision, operations }),
		});
	const reopen = async () => {
		const before = await host.automation.clips();
		await host.close();
		host = await startHost(options);
		expect(await host.automation.clips()).toEqual(before);
		expect(await host.automation.revision()).toBe(revisionOf(revision));
	};
	const accept = async (operations: unknown[]) => {
		const response = await post(operations);
		expect(response.status, JSON.stringify(await response.json())).toBe(200);
		revision++;
		expect(await host.automation.revision()).toBe(revisionOf(revision));
	};
	try {
		await accept(
			variants.flatMap((v) => [
				{
					kind: "create-track",
					track: {
						id: `track-${v.id}`,
						name: v.id,
						kind: v.kind,
						hidden: false,
					},
				},
				{
					kind: "create-clip",
					clip: {
						id: v.id,
						trackId: `track-${v.id}`,
						startTime: 12000,
						duration: 120000,
						trimStart: 0,
						trimEnd: 0,
						editing: editing(v.layer, controls),
					},
				},
			]),
		);
		const checkValues = async (params: Record<string, unknown>) => {
			const clips = await host.automation.clips();
			for (const v of variants)
				expect(clips.find((clip) => clip.id === v.id)?.editing).toMatchObject(
					editing(v.layer, params),
				);
		};
		await checkValues(controls);
		await reopen();
		for (const params of [
			Object.fromEntries(
				Object.entries(bounds).map(([key, [low]]) => [key, low]),
			),
			Object.fromEntries(
				Object.entries(bounds).map(([key, [, high]]) => [key, high]),
			),
			controls,
		]) {
			await accept(
				variants.map((v) => ({
					kind: "update-clip",
					clipId: v.id,
					patch: { editing: editing(v.layer, params) },
				})),
			);
			await checkValues(params);
			await reopen();
		}
		const before = await host.automation.clips();
		const reject = async (
			variant: (typeof variants)[number],
			invalidEditing: unknown,
			label: string,
			expectedIssue?: string,
		) => {
			const sentinel = variants.find((v) => v.id !== variant.id)!;
			const rejected = await post([
				{
					kind: "update-clip",
					clipId: sentinel.id,
					patch: {
						editing: {
							...editing(sentinel.layer, controls),
							name: "Must roll back",
						},
					},
				},
				{
					kind: "update-clip",
					clipId: variant.id,
					patch: { editing: invalidEditing },
				},
			]);
			const details = JSON.stringify(await rejected.json());
			expect(rejected.status, `${label}: ${details}`).toBe(409);
			if (expectedIssue) expect(details, label).toContain(expectedIssue);
			expect(await host.automation.clips(), label).toEqual(before);
			expect(await host.automation.revision(), label).toBe(
				revisionOf(revision),
			);
		};
		for (const v of variants) {
			for (const [key, [low, high]] of Object.entries(bounds))
				for (const value of [low - 1, high + 1])
					await reject(
						v,
						editing(v.layer, { ...controls, [key]: value }),
						`${v.id} ${key}=${value}`,
					);
			for (const seed of [1.5, "37", null])
				await reject(
					v,
					editing(v.layer, { ...controls, seed }),
					`${v.id} seed=${seed}`,
				);
			const { seed: _seed, ...missingSeed } = controls;
			await reject(v, editing(v.layer, missingSeed), `${v.id} missing seed`);
		}
		const clip = variants[0];
		for (const key of ["centerX", "cellSize"]) {
			const missingFallback: Record<string, unknown> = { ...controls };
			delete missingFallback[key];
			await reject(
				clip,
				editing(false, missingFallback),
				`missing ${key} fallback`,
				`editing.effects.distortion.params.${key}: Required effect parameter missing; use catalog defaults`,
			);
		}
		await reject(
			clip,
			editing(false, controls, {
				...animations,
				"effects.distortion.params.seed": channel("seed", [0, 1]),
			}),
			"seed cannot be animated",
			"not keyframable",
		);
		for (const [key, values] of [
			["centerX", [0.5, 2.1]],
			["cellSize", [8.5, 3.5]],
			["displacement", [0, 0.3]],
		] as const)
			await reject(
				clip,
				editing(false, controls, {
					...animations,
					[`effects.distortion.params.${key}`]: channel(key, [...values]),
				}),
				`animated ${key} range`,
			);
		await reopen();
		expect(await host.automation.clips()).toEqual(before);
	} finally {
		await host.close();
		if (
			dirname(root) !== parent ||
			!basename(root).startsWith("rocut-displacement-reopen-")
		)
			throw Error("Unsafe displacement fixture cleanup");
		await rm(root, { recursive: true, force: true });
	}
}, 30000);

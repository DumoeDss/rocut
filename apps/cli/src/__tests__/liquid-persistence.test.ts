import { expect, test } from "bun:test";
import { type EditingChannel, revisionOf } from "@opencut/editor-contracts";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { liquidParameters } from "../../../../script/fixtures/liquid-browser-cases";
import { startHost } from "../host";
import { TargetRegistry } from "../target-registry";

const optical = {
	amount: [0.25, 0.75],
	refraction: [0.125, 0.25],
	dyeOpacity: [0.25, 0.75],
	colorR: [0.125, 0.875],
	colorG: [0.75, 0.25],
	colorB: [1, 0.25],
};
const channel = (key: string, values: number[]): EditingChannel => ({
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
		`effects.fluid.params.${key}`,
		channel(key, values),
	]),
);
const variants = [
	{ id: "liquid-attached", layer: false, kind: "text" },
	{ id: "liquid-layer", layer: true, kind: "effect" },
];
const editing = (
	layer: boolean,
	params: Record<string, unknown>,
	channels: Record<string, EditingChannel> = layer ? {} : animations,
) =>
	layer
		? {
				type: "effect",
				name: "Liquid layer",
				effectType: "liquid",
				params,
				...(Object.keys(channels).length ? { animations: channels } : {}),
			}
		: {
				type: "text",
				name: "Liquid title",
				params: { content: "Liquid persistence fixture" },
				effects: [{ id: "fluid", type: "liquid", enabled: true, params }],
				animations: channels,
			};
const digest = (bytes: Uint8Array) =>
	createHash("sha256").update(bytes).digest("hex");
const byId = <T extends { id: string }>(items: readonly T[]) =>
	[...items].sort((a, b) => a.id.localeCompare(b.id));

test("Liquid Host persists physical events and six optical channels; invalid transactions leave memory and disk unchanged", async () => {
	const parent = resolve(process.env.ROCUT_PROBE_ARTIFACT_ROOT ?? tmpdir());
	await mkdir(parent, { recursive: true });
	const root = await mkdtemp(join(parent, "liquid-persistence-"));
	const options = {
		projectRoot: join(root, "project"),
		registry: new TargetRegistry(join(root, "registry")),
		htmlBrowserExecutable: "",
		htmlFrameConnectionFile: "",
	};
	let host = await startHost(options);
	let revision = 0;
	const evidence = {
		ok: false,
		transport: "real Host api/apply and FileProjectStore project.json",
		editorHistoryTested: false,
		opticalChannels: Object.keys(optical),
		reopens: [] as unknown[],
		rejected: [] as string[],
	};
	const snapshot = async () => ({
		clips: byId(await host.automation.clips()),
		tracks: byId(await host.automation.tracks()),
		authoredTrackOrder: (await host.automation.tracks())
			.filter((track) => variants.some((v) => track.id === `track-${v.id}`))
			.map((track) => track.id),
		revision: await host.automation.revision(),
	});
	const disk = () => readFile(join(options.projectRoot, "project.json"));
	const post = (operations: unknown[]) =>
		fetch(new URL("api/apply", host.editorUrl), {
			method: "POST",
			body: JSON.stringify({ expectedRevision: revision, operations }),
		});
	const accept = async (operations: unknown[]) => {
		const response = await post(operations);
		expect(response.status, JSON.stringify(await response.json())).toBe(200);
		expect(await host.automation.revision()).toBe(revisionOf(++revision));
	};
	const reopen = async (label: string) => {
		const before = await snapshot();
		const persisted = await disk();
		expect(JSON.parse(persisted.toString("utf8")).wrapperVersion).toBe(1);
		await host.close();
		host = await startHost(options);
		expect(await snapshot(), label).toEqual(before);
		evidence.reopens.push({
			label,
			projectSha256: digest(persisted),
			...before,
		});
	};
	try {
		const catalog = await (
			await fetch(new URL("api/editing/catalog", host.editorUrl))
		).json();
		expect(
			catalog.effects.liquid
				.filter((field: { keyframable: boolean }) => field.keyframable)
				.map((field: { key: string }) => field.key)
				.sort(),
		).toEqual(Object.keys(optical).sort());
		const controls = liquidParameters();
		await accept([
			...variants.flatMap((v) => [
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
			{
				kind: "create-clip",
				clip: {
					id: "unrelated",
					trackId: "track-liquid-attached",
					startTime: 144000,
					duration: 24000,
					trimStart: 0,
					trimEnd: 0,
					editing: {
						type: "text",
						name: "Untouched",
						params: { content: "Sentinel" },
					},
				},
			},
		]);
		const assertControls = async (
			params: Record<string, number>,
			channels = animations,
		) => {
			const clips = await host.automation.clips();
			for (const v of variants)
				expect(clips.find((clip) => clip.id === v.id)?.editing).toMatchObject(
					editing(v.layer, params, v.layer ? {} : channels),
				);
		};
		await assertControls(controls);
		await reopen("created attached six-channel animation and static layer");
		const before = await snapshot();
		const persisted = await disk();
		const reject = async (
			layer: boolean,
			invalid: unknown,
			label: string,
			issue?: string,
		) => {
			const response = await post([
				{
					kind: "update-clip",
					clipId: "unrelated",
					patch: {
						editing: {
							type: "text",
							name: "Must roll back",
							params: { content: "Changed" },
						},
					},
				},
				{
					kind: "update-clip",
					clipId: layer ? "liquid-layer" : "liquid-attached",
					patch: { editing: invalid },
				},
			]);
			const details = JSON.stringify(await response.json());
			expect(response.status, `${label}: ${details}`).toBe(409);
			if (issue) expect(details, label).toContain(issue);
			expect(await snapshot(), label).toEqual(before);
			expect(await disk(), label).toEqual(persisted);
			evidence.rejected.push(`${layer ? "layer" : "attached"}: ${label}`);
		};
		for (const { layer } of variants) {
			for (const invalid of [
				{ amount: -0.01 },
				{ refraction: 0.251 },
				{ dyeOpacity: 1.01 },
				{ colorR: -0.01 },
				{ colorG: 1.01 },
				{ colorB: 1.01 },
				{ columns: 7 },
				{ rows: 65 },
				{ columns: 12.5 },
				{ viscosity: 0.021 },
				{ velocityDamping: -1 },
				{ dyeDissipation: 11 },
				{ pressureIterations: 3 },
				{ diffusionIterations: 25 },
				{ vorticity: 5 },
				{ startTicks: -1 },
				{ durationTicks: 999 },
				{ eventCount: 17 },
				{ event0X: -0.1 },
				{ event0Y: 1.1 },
				{ event0Radius: 0 },
				{ event0VelocityX: 3.1 },
				{ event0VelocityY: -3.1 },
				{ event0Dye: 1.1 },
				{ event0Time: 0.5 },
				{ event2Time: controls.durationTicks },
				{ event0Time: 9000 },
				{ amount: "0.5" },
				{ viscosity: null },
				{ typo: 1 },
				{
					columns: 64,
					rows: 64,
					pressureIterations: 80,
					durationTicks: 3600000,
				},
			])
				await reject(
					layer,
					editing(layer, { ...controls, ...invalid }),
					JSON.stringify(invalid),
				);
			for (const key of ["columns", ...Object.keys(optical), "event1Radius"]) {
				const missing: Record<string, unknown> = { ...controls };
				delete missing[key];
				await reject(layer, editing(layer, missing), `missing ${key}`);
			}
		}
		for (const [key, values] of Object.entries(optical)) {
			await reject(
				true,
				editing(true, controls, { [key]: channel(key, values) }),
				`unsupported layer ${key} animation`,
				"effect-layer renderer does not animate",
			);
			await reject(
				false,
				editing(false, controls, {
					...animations,
					[`effects.fluid.params.${key}`]: channel(key, [
						values[0],
						key === "refraction" ? 0.251 : 1.01,
					]),
				}),
				`out-of-range ${key} animation`,
			);
		}
		for (const key of Object.keys(controls).filter((key) => !(key in optical)))
			await reject(
				false,
				editing(false, controls, {
					...animations,
					[`effects.fluid.params.${key}`]: channel(key, [
						controls[key],
						controls[key],
					]),
				}),
				`physical ${key} animation`,
				"not keyframable",
			);
		await reopen("all invalid batches left memory and disk unchanged");
		const updated = liquidParameters({
			viscosity: 0.001,
			event1Radius: 0.5,
			event1VelocityX: 1.5,
		});
		const updatedChannels = Object.fromEntries(
			Object.entries(optical).map(([key, values]) => [
				`effects.fluid.params.${key}`,
				channel(key, [...values].reverse()),
			]),
		);
		await accept(
			variants.map((v) => ({
				kind: "update-clip",
				clipId: v.id,
				patch: {
					editing: editing(v.layer, updated, v.layer ? {} : updatedChannels),
				},
			})),
		);
		await assertControls(updated, updatedChannels);
		expect(
			(await snapshot()).clips.find((clip) => clip.id === "unrelated"),
		).toEqual(before.clips.find((clip) => clip.id === "unrelated"));
		expect((await snapshot()).tracks).toEqual(before.tracks);
		await reopen("edited physical event and all six optical channels");
		evidence.ok = true;
	} finally {
		await host.close();
		await writeFile(
			join(root, "evidence.json"),
			JSON.stringify(evidence, null, 2),
		);
		console.log(
			JSON.stringify({
				liquidPersistenceArtifacts: root,
				...evidence,
				reopens: evidence.reopens.length,
			}),
		);
	}
}, 30000);

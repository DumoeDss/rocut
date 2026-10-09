import { expect, test } from "bun:test";
import { type EditingChannel, revisionOf } from "@opencut/editor-contracts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, parse, resolve } from "node:path";
import { startHost } from "../host";
import { TargetRegistry } from "../target-registry";

type RevealType = "laser" | "decrypt-reveal";
type Variant = { id: string; type: RevealType; layer: boolean };
const controls: Record<RevealType, Record<string, number>> = {
	laser: {
		amount: 1,
		progress: 0.25,
		direction: 1,
		width: 0.025,
		feather: 0.3,
		glow: 0.5,
		colorR: 0.2,
		colorG: 0.85,
		colorB: 1,
	},
	"decrypt-reveal": {
		amount: 1,
		progress: 0.25,
		cellSize: 12.25,
		contrast: 1,
		seed: 37,
		centerX: 0.4,
		centerY: 0.6,
		radius: 0.35,
		feather: 0.2,
		colorR: 0.2,
		colorG: 1,
		colorB: 0.55,
	},
};
const bounds: Record<RevealType, Record<string, readonly [number, number]>> = {
	laser: {
		amount: [0, 1],
		progress: [0, 1],
		direction: [0, 3],
		width: [0, 0.25],
		feather: [0, 1],
		glow: [0, 1],
		colorR: [0, 1],
		colorG: [0, 1],
		colorB: [0, 1],
	},
	"decrypt-reveal": {
		amount: [0, 1],
		progress: [0, 1],
		cellSize: [6, 64],
		contrast: [-2, 2],
		seed: [0, 65535],
		centerX: [-1, 2],
		centerY: [-1, 2],
		radius: [0, 2],
		feather: [0, 1],
		colorR: [0, 1],
		colorG: [0, 1],
		colorB: [0, 1],
	},
};
const variants: Variant[] = ["laser", "decrypt-reveal"].flatMap((type) =>
	[false, true].map((layer) => ({
		id: `${type}-${layer ? "layer" : "clip"}`,
		type: type as RevealType,
		layer,
	})),
);
const property = (v: Variant, key: string) =>
	v.layer ? key : `effects.${v.type}.params.${key}`;
const channel = (id: string, values: readonly number[]): EditingChannel => ({
	keys: values.map((value, index) => ({
		id: `${id}-${index}`,
		time: index * 120000,
		value,
		segmentToNext: "linear",
		tangentMode: "auto",
	})),
});
const progressChannels = (v: Variant, values: readonly number[] = [0, 1]) => ({
	[property(v, "progress")]: channel(`${v.id}-progress`, values),
});
const editing = (
	v: Variant,
	params: Record<string, unknown>,
	animations: Record<string, EditingChannel> = v.layer
		? {}
		: progressChannels(v),
) =>
	v.layer
		? {
				type: "effect",
				name: v.id,
				effectType: v.type,
				params,
				...(Object.keys(animations).length ? { animations } : {}),
			}
		: {
				type: "text",
				name: v.id,
				params: { content: "Reveal persistence fixture" },
				effects: [{ id: v.type, type: v.type, enabled: true, params }],
				animations,
			};

test("animated reveal clip effects and static effect layers persist and reject invalid batches atomically", async () => {
	const parent = resolve(tmpdir());
	if (
		process.platform === "win32" &&
		parse(parent).root.toUpperCase() !== "E:\\"
	)
		throw Error(
			"Set TEMP/TMP to the private E: fixture before reveal persistence tests",
		);
	const root = await mkdtemp(join(parent, "rocut-reveal-reopen-"));
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
	const accept = async (operations: unknown[]) => {
		const response = await post(operations);
		expect(response.status, JSON.stringify(await response.json())).toBe(200);
		revision++;
		expect(await host.automation.revision()).toBe(revisionOf(revision));
	};
	const reopen = async () => {
		const clips = await host.automation.clips();
		const tracks = await host.automation.tracks();
		const topology = (await host.automation.project())?.sceneState;
		expect(topology?.scenes).toHaveLength(1);
		const mainTrackId = topology?.scenes[0]?.mainTrackId;
		expect(mainTrackId).toBeDefined();
		expect(tracks.find((track) => track.id === mainTrackId)).toMatchObject({
			kind: "video",
			name: "Main Track",
		});
		expect(tracks).toHaveLength(variants.length + 1);
		expect(clips.some((clip) => clip.trackId === mainTrackId)).toBe(false);
		const authoredTracks = tracks.filter((track) => track.id !== mainTrackId);
		expect(authoredTracks.map((track) => String(track.id))).toEqual(
			variants.map((v) => `track-${v.id}`),
		);
		await host.close();
		host = await startHost(options);
		const reopenedClips = await host.automation.clips();
		const reopenedTracks = await host.automation.tracks();
		expect(reopenedClips).toEqual(clips);
		expect((await host.automation.project())?.sceneState).toEqual(topology);
		expect(reopenedClips.some((clip) => clip.trackId === mainTrackId)).toBe(
			false,
		);
		// Native persistence has separate overlay/main/audio lanes. Reopening
		// places the empty canonical main after overlays; author order stays exact.
		expect(reopenedTracks).toHaveLength(tracks.length);
		for (const track of tracks)
			expect(
				reopenedTracks.find((candidate) => candidate.id === track.id),
			).toEqual(track);
		expect(reopenedTracks.filter((track) => track.id !== mainTrackId)).toEqual(
			authoredTracks,
		);
		expect(await host.automation.revision()).toBe(revisionOf(revision));
	};
	try {
		const response = await fetch(
			new URL("api/editing/catalog", host.editorUrl),
		);
		expect(response.status).toBe(200);
		const catalog = await response.json();
		for (const type of ["laser", "decrypt-reveal"] as const) {
			const fields = catalog.effects[type] as {
				key: string;
				keyframable?: boolean;
			}[];
			expect(fields.map((field) => field.key).sort()).toEqual(
				Object.keys(controls[type]).sort(),
			);
			expect(
				fields.find((field) => field.key === "progress")?.keyframable,
			).toBe(true);
			const discrete = type === "laser" ? "direction" : "seed";
			expect(fields.find((field) => field.key === discrete)?.keyframable).toBe(
				false,
			);
		}
		await accept(
			variants.flatMap((v) => [
				{
					kind: "create-track",
					track: {
						id: `track-${v.id}`,
						name: v.id,
						kind: v.layer ? "effect" : "text",
						hidden: false,
					},
				},
				{
					kind: "create-clip",
					clip: {
						id: v.id,
						trackId: `track-${v.id}`,
						startTime: 12000,
						duration: 240000,
						trimStart: 0,
						trimEnd: 0,
						editing: editing(v, controls[v.type]),
					},
				},
			]),
		);
		const initial = await host.automation.clips();
		for (const v of variants)
			expect(initial.find((clip) => clip.id === v.id)?.editing).toMatchObject(
				editing(v, controls[v.type]),
			);
		await reopen();
		const before = await host.automation.clips();
		const tracksBefore = await host.automation.tracks();
		const reject = async (
			v: Variant,
			invalid: unknown,
			label: string,
			issue?: string,
		) => {
			const sentinel = variants.find((other) => other.id !== v.id)!;
			const response = await post([
				{
					kind: "create-track",
					track: {
						id: "must-roll-back",
						name: "Atomic sentinel",
						kind: "text",
						hidden: false,
					},
				},
				{
					kind: "update-clip",
					clipId: sentinel.id,
					patch: {
						editing: {
							...editing(sentinel, controls[sentinel.type]),
							name: "Must roll back",
						},
					},
				},
				{ kind: "update-clip", clipId: v.id, patch: { editing: invalid } },
			]);
			const details = JSON.stringify(await response.json());
			expect(response.status, `${label}: ${details}`).toBe(409);
			if (issue) expect(details, label).toContain(issue);
			expect(await host.automation.revision(), label).toBe(
				revisionOf(revision),
			);
			expect(await host.automation.clips(), label).toEqual(before);
			expect(await host.automation.tracks(), label).toEqual(tracksBefore);
		};
		for (const v of variants) {
			const values = controls[v.type];
			for (const [key, [low, high]] of Object.entries(bounds[v.type]))
				for (const value of [low - 1, high + 1])
					await reject(
						v,
						editing(v, { ...values, [key]: value }),
						`${v.id} ${key}=${value}`,
					);
			const discrete = v.type === "laser" ? "direction" : "seed";
			await reject(
				v,
				editing(v, { ...values, [discrete]: 1.5 }),
				`${v.id} fractional ${discrete}`,
			);
			for (const key of ["progress", discrete]) {
				for (const value of ["0.5", true, null])
					await reject(
						v,
						editing(v, { ...values, [key]: value }),
						`${v.id} ${key} invalid type`,
					);
				const missing: Record<string, unknown> = { ...values };
				delete missing[key];
				await reject(
					v,
					editing(v, missing),
					`${v.id} missing ${key}`,
					v.layer
						? "Required effect layer parameter missing"
						: "Required effect parameter missing",
				);
			}
			await reject(
				v,
				editing(v, { ...values, typo: 1 }),
				`${v.id} unknown parameter`,
			);
			if (v.layer) {
				for (const key of ["progress", discrete])
					await reject(
						v,
						editing(v, values, {
							[property(v, key)]: channel(`${v.id}-${key}`, [0, 1]),
						}),
						`${v.id} layer ${key} animation unsupported`,
						"The current effect-layer renderer does not animate layer parameters",
					);
			} else {
				await reject(
					v,
					editing(v, values, {
						...progressChannels(v),
						[property(v, discrete)]: channel(`${v.id}-discrete`, [0, 1]),
					}),
					`${v.id} discrete animation`,
					"not keyframable",
				);
				await reject(
					v,
					editing(v, values, progressChannels(v, [0, 1.1])),
					`${v.id} animated progress range`,
				);
			}
		}
		await reopen();
		expect(await host.automation.clips()).toEqual(before);
		await accept(
			variants.map((v) => ({
				kind: "update-clip",
				clipId: v.id,
				patch: {
					editing: editing(
						v,
						{
							...controls[v.type],
							progress: 0.75,
							[v.type === "laser" ? "direction" : "seed"]:
								v.type === "laser" ? 3 : 321,
						},
						v.layer ? {} : progressChannels(v, [0.2, 0.8]),
					),
				},
			})),
		);
		const updated = await host.automation.clips();
		for (const v of variants)
			expect(updated.find((clip) => clip.id === v.id)?.editing).toMatchObject(
				editing(
					v,
					{
						...controls[v.type],
						progress: 0.75,
						[v.type === "laser" ? "direction" : "seed"]:
							v.type === "laser" ? 3 : 321,
					},
					v.layer ? {} : progressChannels(v, [0.2, 0.8]),
				),
			);
		expect(
			(await host.automation.tracks()).some(
				(track) => track.id === "must-roll-back",
			),
		).toBe(false);
		await reopen();
	} finally {
		await host.close();
		if (
			dirname(root) !== parent ||
			!basename(root).startsWith("rocut-reveal-reopen-")
		)
			throw Error("Unsafe reveal fixture cleanup");
		await rm(root, { recursive: true, force: true });
	}
}, 60000);

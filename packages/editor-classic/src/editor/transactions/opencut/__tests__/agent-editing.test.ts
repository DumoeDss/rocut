import { expect, test } from "bun:test";
import {
	clipId,
	assetId,
	mediaTime,
	revisionOf,
	trackId,
	type ClipEditing,
	type TransactionOperation,
} from "@opencut/editor-contracts";
import {
	openTransactionEngine,
	bindNativeCommittedTransactionStateCapture,
} from "@opencut/editor-contracts/engine";
import {
	createDraftEditingManager,
	createInMemoryDraftResourceRetentionPolicy,
} from "@opencut/editor-contracts/draft";
import { createOpenCutTransactionDocumentAdapter } from "../adapter";
import {
	openCutEditingPolicy,
	validateDocumentEditing,
} from "../editing-policy";
import { editingCatalog } from "../editing-catalog";
import { planSceneMutation } from "../scene-policy";
import { storeFixture, TEST_PROJECT_ID } from "./fixture";
import { encodeProject } from "../../../persistence/project-codec";

async function fixture() {
	const { store } = await storeFixture();
	const open = async () => {
		const record = await store.load({ id: TEST_PROJECT_ID });
		if (!record) throw new Error("missing record");
		const adapter = createOpenCutTransactionDocumentAdapter({
			initialRecord: record,
			initialAssets: [],
			validateEditing: validateDocumentEditing,
		});
		const save = store.save.bind(store);
		store.save = async (args) => {
			await save(args);
			adapter.adoptCommittedRecord(args.record);
		};
		const automation = await openTransactionEngine({
			store,
			projectId: TEST_PROJECT_ID,
			documentAdapter: adapter,
			placementPolicies: [openCutEditingPolicy],
		});
		return { adapter, automation };
	};
	return { ...(await open()), open, store };
}

const zero = mediaTime({ ticks: 0 });
const duration = mediaTime({ ticks: 240_000 });

test("an adopted native editing change cannot be silently overwritten by a stale engine", async () => {
	const f = await fixture();
	await f.automation.apply({
		operations: create({
			id: "title",
			editing: { type: "text", params: { content: "base" } },
		}),
	});
	const stored = await f.store.load({ id: TEST_PROJECT_ID });
	if (!stored) throw new Error("missing record");
	const external = f.adapter.currentDraft();
	external.project.scenes[0].tracks.overlay[0].elements[0].params.content =
		"UI edit";
	f.adapter.adoptCommittedRecord({
		...stored,
		data: encodeProject({ project: external.project, retained: stored.data }),
	});
	await expect(
		f.automation.apply({
			operations: [
				{
					kind: "update-track",
					trackId: trackId("main-track"),
					patch: { name: "unrelated" },
				},
			],
		}),
	).rejects.toThrow();
	expect(await f.store.load({ id: TEST_PROJECT_ID })).toEqual(stored);
	expect(
		f.adapter.currentDraft().project.scenes[0].tracks.overlay[0].elements[0]
			.params.content,
	).toBe("UI edit");
});
function create({
	id,
	editing,
	kind = "text",
}: {
	id: string;
	editing: ClipEditing;
	kind?: "text" | "graphic";
}): TransactionOperation[] {
	return [
		{
			kind: "create-track",
			track: { id: trackId(`track-${id}`), name: id, kind, hidden: false },
		},
		{
			kind: "create-clip",
			clip: {
				id: clipId(id),
				trackId: trackId(`track-${id}`),
				startTime: zero,
				duration,
				trimStart: zero,
				trimEnd: zero,
				editing,
			},
		},
	];
}
const scalar = ({
	id,
	time,
	value,
}: {
	id: string;
	time: number;
	value: number;
}) => ({
	id,
	time,
	value,
	segmentToNext: "bezier" as const,
	tangentMode: "broken" as const,
	rightHandle: { dt: 4000, dv: 0 },
});

test("Agent text, transforms, curves, effects, masks and graphics survive native save/reopen", async () => {
	const f = await fixture();
	const catalog = editingCatalog();
	const text: ClipEditing = {
		type: "text",
		name: "标题",
		params: {
			content: "字幕与标题",
			fontSize: 72,
			"transform.positionX": 150,
			"transform.scaleX": 1.2,
			opacity: 0.8,
			blendMode: "screen",
			"background.enabled": true,
		},
		effects: [
			{ id: "blur-a", type: "blur", enabled: true, params: { intensity: 15 } },
		],
		animations: {
			opacity: {
				keys: [
					scalar({ id: "a", time: 0, value: 0 }),
					scalar({ id: "b", time: 120000, value: 1 }),
				],
			},
			"effects.blur-a.params.intensity": {
				keys: [
					scalar({ id: "c", time: 0, value: 1 }),
					scalar({ id: "d", time: 120000, value: 25 }),
				],
			},
		},
	};
	const graphic: ClipEditing = {
		type: "graphic",
		definitionId: "rectangle",
		params: { fill: "#ff0000", cornerRadius: 20 },
		masks: [
			{
				id: "mask-a",
				type: "rectangle",
				params: { ...catalog.masks.rectangle.defaults, inverted: true },
			},
		],
	};
	await f.automation.apply({
		expectedRevision: revisionOf(0),
		idempotencyKey: "rich-create",
		operations: [
			...create({ id: "title", editing: text }),
			...create({ id: "shape", editing: graphic, kind: "graphic" }),
		],
	});
	const saved = f.adapter.currentDraft().project.scenes[0].tracks.overlay;
	expect(saved[0].elements[0]).toMatchObject(text);
	expect(saved[1].elements[0]).toMatchObject(graphic);
	const reopened = await f.open();
	expect(
		(await reopened.automation.clips()).find((c) => c.id === "title")?.editing,
	).toMatchObject(text);
	const cleared = {
		...text,
		params: { content: "Only the text remains" },
		animations: {},
		effects: [],
	};
	await reopened.automation.apply({
		expectedRevision: revisionOf(1),
		operations: [
			{
				kind: "update-clip",
				clipId: clipId("title"),
				patch: { editing: cleared },
			},
		],
	});
	const clearedRead = (await (await f.open()).automation.clips()).find(
		(c) => c.id === "title",
	)?.editing;
	expect(clearedRead?.params).toEqual(cleared.params);
	expect(clearedRead?.animations).toEqual({});
	expect(clearedRead?.effects).toEqual([]);
});

test("invalid editing is rejected atomically, including dry-run, without changing revision or persisted bytes", async () => {
	const f = await fixture();
	const before = await f.store.load({ id: TEST_PROJECT_ID });
	for (const editing of [
		{ type: "text", params: { opacity: 2 } },
		{ type: "text", params: { unknown: 1 } },
		{
			type: "text",
			params: {},
			masks: [{ id: "m", type: "ellipse", params: {} }],
		},
		{
			type: "text",
			params: {},
			animations: {
				opacity: {
					keys: [
						scalar({ id: "same", time: 0, value: 0 }),
						scalar({ id: "same", time: 1, value: 1 }),
					],
				},
			},
		},
		{
			type: "text",
			params: {},
			effects: [{ id: "x", type: "missing", enabled: true, params: {} }],
		},
		{
			type: "text",
			params: {},
			effects: [{ id: "x", type: "blur", enabled: true, params: {} }],
		},
	] as ClipEditing[]) {
		const batch = { operations: create({ id: "bad", editing: editing }) };
		expect((await f.automation.dryRun(batch)).accepted).toBe(false);
		await expect(f.automation.apply(batch)).rejects.toThrow();
		expect(await f.automation.revision()).toBe(0);
		expect(await f.store.load({ id: TEST_PROJECT_ID })).toEqual(before);
	}
});

test("editing updates retain expected-revision, idempotency and draft isolation", async () => {
	const f = await fixture();
	await f.automation.apply({
		operations: create({
			id: "title",
			editing: {
				type: "text",
				params: { content: "before" },
			},
		}),
	});
	const operations: TransactionOperation[] = [
		{
			kind: "update-clip",
			clipId: clipId("title"),
			patch: { editing: { type: "text", params: { content: "after" } } },
		},
	];
	const batch = {
		expectedRevision: revisionOf(1),
		idempotencyKey: "text-edit",
		operations,
	};
	const first = await f.automation.apply(batch);
	expect(await f.automation.apply(batch)).toEqual(first);
	await expect(
		f.automation.apply({ expectedRevision: revisionOf(1), operations }),
	).rejects.toThrow();
	expect(await f.automation.revision()).toBe(2);
	const committedState = bindNativeCommittedTransactionStateCapture(
		f.automation,
	);
	if (!committedState) throw new Error("Missing committed-state capture");
	const drafts = createDraftEditingManager({
		engine: f.automation,
		committedState,
		placementPolicies: [openCutEditingPolicy],
		retentionPolicy: createInMemoryDraftResourceRetentionPolicy(),
	});
	const draft = await drafts.open({
		id: "edit-preview",
		approvalMode: "manual",
	});
	if (!draft.opened) throw new Error("draft did not open");
	const staged = await draft.session.stage({
		operations: [
			{
				kind: "update-clip",
				clipId: clipId("title"),
				patch: { editing: { type: "text", params: { content: "draft" } } },
			},
		],
	});
	expect(staged.accepted).toBe(true);
	expect((await f.automation.clips())[0].editing?.params.content).toBe("after");
});

test("track mute and audio gain/volume animation persist with source-audio controls", async () => {
	const f = await fixture();
	const audio: ClipEditing = {
		type: "audio",
		params: { volume: -6, muted: false },
		animations: {
			volume: {
				keys: [
					scalar({ id: "v1", time: 0, value: -12 }),
					scalar({ id: "v2", time: 120000, value: 0 }),
				],
			},
		},
	};
	const video: ClipEditing = {
		type: "video",
		params: { volume: -3 },
		isSourceAudioEnabled: false,
	};
	await f.automation.apply({
		operations: [
			{
				kind: "create-asset",
				asset: {
					id: assetId("av"),
					kind: "video",
					name: "av",
					duration,
					hasAudio: true,
				},
			},
			{
				kind: "create-track",
				track: {
					id: trackId("sound"),
					kind: "audio",
					name: "Sound",
					hidden: false,
				},
			},
			{
				kind: "create-clip",
				clip: {
					id: clipId("sound-clip"),
					trackId: trackId("sound"),
					assetId: assetId("av"),
					sourceComponent: "audio",
					startTime: zero,
					duration,
					trimStart: zero,
					trimEnd: zero,
					editing: audio,
				},
			},
			{
				kind: "create-clip",
				clip: {
					id: clipId("video-clip"),
					trackId: trackId("main-track"),
					assetId: assetId("av"),
					startTime: zero,
					duration,
					trimStart: zero,
					trimEnd: zero,
					editing: video,
				},
			},
			{
				kind: "update-track",
				trackId: trackId("main-track"),
				patch: { muted: true },
			},
		],
	});
	const reopened = await f.open();
	expect(
		(await reopened.automation.clips()).find((clip) => clip.id === "sound-clip")
			?.editing,
	).toMatchObject(audio);
	expect(
		(await reopened.automation.clips()).find((clip) => clip.id === "video-clip")
			?.editing,
	).toMatchObject(video);
	expect((await (await f.open()).automation.tracks())[0].muted).toBe(true);
	expect(f.adapter.currentDraft().project.scenes[0].tracks.main.muted).toBe(
		true,
	);
});

test("ordinary registered effect layers persist and validate their required parameters", async () => {
	const f = await fixture();
	await f.automation.apply({
		operations: [
			{
				kind: "create-track",
				track: {
					id: trackId("fx"),
					name: "Effects",
					kind: "effect",
					hidden: false,
				},
			},
			{
				kind: "create-clip",
				clip: {
					id: clipId("blur-layer"),
					trackId: trackId("fx"),
					startTime: zero,
					duration,
					trimStart: zero,
					trimEnd: zero,
					editing: {
						type: "effect",
						effectType: "blur",
						params: { intensity: 12 },
					},
				},
			},
		],
	});
	expect((await (await f.open()).automation.clips())[0].editing).toMatchObject({
		type: "effect",
		effectType: "blur",
		params: { intensity: 12 },
	});
	await expect(
		f.automation.apply({
			operations: [
				{
					kind: "update-clip",
					clipId: clipId("blur-layer"),
					patch: {
						editing: { type: "effect", effectType: "blur", params: {} },
					},
				},
			],
		}),
	).rejects.toThrow();
});

test("stickers, freeform masks and color channels roundtrip without private native writes", async () => {
	const f = await fixture();
	const graphic: ClipEditing = {
		type: "graphic",
		definitionId: "rectangle",
		params: { fill: "#ffffff" },
		masks: [
			{
				id: "free",
				type: "freeform",
				params: {
					...editingCatalog().masks.freeform.defaults,
					path: [
						{ id: "p1", x: 0, y: 0, inX: 0, inY: 0, outX: 0, outY: 0 },
						{ id: "p2", x: 1, y: 0, inX: 1, inY: 0, outX: 1, outY: 0 },
						{ id: "p3", x: 0, y: 1, inX: 0, inY: 1, outX: 0, outY: 1 },
					],
				},
			},
		],
		animations: {
			"params.fill": {
				r: { keys: [scalar({ id: "red", time: 0, value: 0.5 })] },
			},
		},
	};
	const sticker: ClipEditing = {
		type: "sticker",
		stickerId: "noto:star",
		intrinsicWidth: 128,
		intrinsicHeight: 128,
		params: { opacity: 0.5 },
	};
	await f.automation.apply({
		operations: [
			...create({ id: "shape-free", editing: graphic, kind: "graphic" }),
			...create({ id: "sticker", editing: sticker, kind: "graphic" }),
		],
	});
	const reopened = await f.open();
	expect(
		(await reopened.automation.clips()).find((clip) => clip.id === "shape-free")
			?.editing,
	).toMatchObject(graphic);
	expect(
		(await reopened.automation.clips()).find((clip) => clip.id === "sticker")
			?.editing,
	).toMatchObject(sticker);
});

test("Agent scene lifecycle preserves inactive timelines and protects the canonical main scene", async () => {
	const f = await fixture();
	const sceneEdit = async (operation: unknown) => {
		const document = {
			project: await f.automation.project(),
			tracks: await f.automation.tracks(),
			markers: await f.automation.markers(),
		};
		return f.automation.apply({
			expectedRevision: await f.automation.revision(),
			operations: planSceneMutation({ document, operation }),
		});
	};
	await f.automation.apply({
		operations: create({
			id: "original",
			editing: {
				type: "text",
				params: { content: "Main scene text" },
			},
		}),
	});
	await sceneEdit({
		kind: "create",
		id: "scene-two",
		name: "Second scene",
		mainTrackId: "main-two",
	});
	await sceneEdit({ kind: "rename", id: "scene-two", name: "副歌场景" });
	await sceneEdit({ kind: "switch", id: "scene-two" });
	await f.automation.apply({
		operations: create({
			id: "second",
			editing: {
				type: "text",
				params: { content: "Second scene text" },
			},
		}),
	});
	expect((await f.automation.clips()).map((clip) => clip.id)).toEqual([
		"original",
		"second",
	]);
	const reopened = await f.open();
	expect(
		reopened.adapter
			.currentDraft()
			.project.scenes.map((scene) => [scene.id, scene.tracks.overlay.length]),
	).toEqual([
		["scene-main", 1],
		["scene-two", 1],
	]);
	expect(
		(await reopened.automation.project())?.sceneState?.currentSceneId,
	).toBe("scene-two");
	const current = (await f.automation.project())!;
	const invalid = {
		...current.sceneState!,
		scenes: current.sceneState!.scenes.filter((scene) => !scene.isMain),
	};
	const forbidden: TransactionOperation[] = [
		{
			kind: "update-project",
			projectId: current.id,
			patch: { sceneState: invalid },
		},
	];
	expect((await f.automation.dryRun({ operations: forbidden })).accepted).toBe(
		false,
	);
	await sceneEdit({ kind: "delete", id: "scene-two" });
	expect((await f.automation.clips()).map((clip) => clip.id)).toEqual([
		"original",
	]);
	expect((await f.automation.project())?.sceneState?.currentSceneId).toBe(
		"scene-main",
	);
	expect(
		(await (await f.open()).automation.tracks()).map((track) => track.sceneId),
	).toEqual(["scene-main", "scene-main"]);
});

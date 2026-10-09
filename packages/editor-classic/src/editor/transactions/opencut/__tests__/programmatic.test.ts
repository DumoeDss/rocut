import { expect, test } from "bun:test";
import {
	clipId,
	mediaTime,
	revisionOf,
	trackId,
	type ClipEditing,
	type ProgrammaticSource,
	type TransactionBatch,
} from "@opencut/editor-contracts";
import { openTransactionEngine } from "@opencut/editor-contracts/engine";
import { createOpenCutTransactionDocumentAdapter } from "../adapter";
import {
	openCutEditingPolicy,
	validateDocumentEditing,
} from "../editing-policy";
import { storeFixture, TEST_PROJECT_ID } from "./fixture";
import { resolveProgrammaticFrame } from "../../../../services/renderer/programmatic/frame";
import { getVisibleElementsWithBounds } from "../../../../preview/element-bounds";

const source: ProgrammaticSource = {
	version: 1,
	runtime: "canvas-worker",
	code: "canvas.getContext('2d').fillRect(frame.index,0,4,4)",
	width: 64,
	height: 32,
	frameRate: { numerator: 30, denominator: 1 },
	durationFrames: 90,
	seed: 7,
	resources: [
		{
			id: "images/original.png",
			kind: "image",
			mimeType: "image/png",
			byteLength: 100,
			sha256: "a".repeat(64),
			attachmentKey: `programmatic-sha256-${"a".repeat(64)}`,
		},
	],
};
const editing: ClipEditing = {
	type: "graphic",
	definitionId: "programmatic",
	params: { opacity: 0.75 },
	programmatic: source,
};
const zero = mediaTime({ ticks: 0 });

async function fixture() {
	const { store } = await storeFixture();
	const open = async () => {
		const record = await store.load({ id: TEST_PROJECT_ID });
		if (!record) throw new Error("missing fixture");
		const adapter = createOpenCutTransactionDocumentAdapter({
			initialRecord: record,
			initialAssets: [],
			validateEditing: validateDocumentEditing,
		});
		const automation = await openTransactionEngine({
			store,
			projectId: TEST_PROJECT_ID,
			documentAdapter: adapter,
			placementPolicies: [openCutEditingPolicy],
		});
		return { adapter, automation };
	};
	return { store, open, ...(await open()) };
}

test("Agent creates, reopens, replaces and removes source without resurrecting persisted code", async () => {
	const f = await fixture();
	await f.automation.apply({
		expectedRevision: revisionOf(0),
		operations: [
			{
				kind: "create-track",
				track: {
					id: trackId("procedural"),
					kind: "graphic",
					name: "Procedural",
					hidden: false,
				},
			},
			{
				kind: "create-clip",
				clip: {
					id: clipId("source"),
					trackId: trackId("procedural"),
					startTime: zero,
					duration: mediaTime({ ticks: 240000 }),
					trimStart: mediaTime({ ticks: 4000 }),
					trimEnd: zero,
					editing,
				},
			},
		],
	});
	let reopened = await f.open();
	const bounds = getVisibleElementsWithBounds({
		tracks: reopened.adapter.currentDraft().project.scenes[0].tracks,
		currentTime: 0,
		canvasSize: { width: 1280, height: 720 },
		mediaAssets: [],
	});
	expect(
		bounds.find((element) => element.elementId === "source")?.bounds,
	).toMatchObject({ width: 1280, height: 640 });
	expect(
		(await reopened.automation.clips()).find((c) => c.id === "source")?.editing,
	).toMatchObject(editing);
	const changed = {
		...editing,
		programmatic: {
			...source,
			runtime: "html-document" as const,
			code: "<div>新的独立画面</div>",
			seed: 9,
			resources: [
				{
					id: "images/replaced.png",
					kind: "image" as const,
					mimeType: "image/png",
					byteLength: 120,
					sha256: "b".repeat(64),
					attachmentKey: `programmatic-sha256-${"b".repeat(64)}`,
				},
			],
		},
	};
	await reopened.automation.apply({
		expectedRevision: revisionOf(1),
		operations: [
			{
				kind: "update-clip",
				clipId: clipId("source"),
				patch: { editing: changed },
			},
		],
	});
	reopened = await f.open();
	expect(
		(await reopened.automation.clips()).find((c) => c.id === "source")?.editing
			?.programmatic,
	).toEqual(changed.programmatic);
	expect(
		JSON.stringify(await f.store.load({ id: TEST_PROJECT_ID })),
	).not.toContain("original.png");
	await reopened.automation.apply({
		expectedRevision: revisionOf(2),
		operations: [
			{
				kind: "update-clip",
				clipId: clipId("source"),
				patch: {
					editing: { type: "graphic", definitionId: "rectangle", params: {} },
				},
			},
		],
	});
	reopened = await f.open();
	expect(
		(await reopened.automation.clips()).find((c) => c.id === "source")?.editing
			?.programmatic,
	).toBeUndefined();
	expect(
		JSON.stringify(await f.store.load({ id: TEST_PROJECT_ID })),
	).not.toContain("新的独立画面");
});

test("unsupported runtimes and malformed sources fail before persistence, including dry run", async () => {
	const f = await fixture();
	const before = await f.store.load({ id: TEST_PROJECT_ID });
	for (const programmatic of [
		{ ...source, width: 0 },
		{ ...source, durationFrames: 1 },
		{ ...source, runtime: "remotion" },
		{ ...source, resources: [{ ...source.resources![0], id: "../private" }] },
	]) {
		const batch: TransactionBatch = {
			operations: [
				{
					kind: "create-track",
					track: {
						id: trackId("p"),
						kind: "graphic",
						name: "P",
						hidden: false,
					},
				},
				{
					kind: "create-clip",
					clip: {
						id: clipId("p"),
						trackId: trackId("p"),
						startTime: zero,
						duration: mediaTime({ ticks: 240000 }),
						trimStart: zero,
						trimEnd: zero,
						// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Deliberately malformed wire data verifies runtime rejection, not TS assignability.
						editing: { ...editing, programmatic } as ClipEditing,
					},
				},
			],
		};
		expect((await f.automation.dryRun(batch)).accepted).toBe(false);
		await expect(f.automation.apply(batch)).rejects.toThrow();
		expect(await f.store.load({ id: TEST_PROJECT_ID })).toEqual(before);
	}
});

test("real WASM produces deterministic source frames with trim and half-open boundaries", () => {
	const map = (timelineTime: number) =>
		resolveProgrammaticFrame({
			source,
			clipStart: 120000,
			clipDuration: 240000,
			trimStart: 4000,
			timelineTime,
		});
	expect(map(119999)).toBeNull();
	expect(map(360000)).toBeNull();
	expect(map(120000)).toMatchObject({ index: 1, sourceTime: 4000 });
	expect(map(124000)).toMatchObject({ index: 2, sourceTime: 8000 });
	expect(map(120000)).toEqual(map(120000));
});

test("compiled document references survive Agent save/reopen and disappear on inline replacement", async () => {
	const f = await fixture();
	const compiled: ProgrammaticSource = {
		...source,
		runtime: "html-document",
		code: "",
		documentId: "build/native.html",
		resources: [
			{
				id: "build/native.html",
				kind: "document",
				mimeType: "text/html",
				byteLength: 700000,
				sha256: "c".repeat(64),
				attachmentKey: `programmatic-sha256-${"c".repeat(64)}`,
			},
		],
	};
	await f.automation.apply({
		expectedRevision: revisionOf(0),
		operations: [
			{
				kind: "create-track",
				track: {
					id: trackId("native-track"),
					kind: "graphic",
					name: "Native",
					hidden: false,
				},
			},
			{
				kind: "create-clip",
				clip: {
					id: clipId("native"),
					trackId: trackId("native-track"),
					startTime: zero,
					duration: mediaTime({ ticks: 120000 }),
					trimStart: zero,
					trimEnd: zero,
					editing: { ...editing, programmatic: compiled },
				},
			},
		],
	});
	let reopened = await f.open();
	expect(
		(await reopened.automation.clips()).find((c) => c.id === "native")?.editing
			?.programmatic,
	).toEqual(compiled);
	await reopened.automation.apply({
		expectedRevision: revisionOf(1),
		operations: [
			{
				kind: "update-clip",
				clipId: clipId("native"),
				patch: { editing },
			},
		],
	});
	reopened = await f.open();
	expect(
		(await reopened.automation.clips()).find((c) => c.id === "native")?.editing
			?.programmatic,
	).toEqual(source);
	expect(
		JSON.stringify(await f.store.load({ id: TEST_PROJECT_ID })),
	).not.toContain("build/native.html");
});

test("MV recipe persists through Agent transactions; invalid graphs cannot change revision", async () => {
	const f = await fixture();
	const recipeSource: ProgrammaticSource = {
		...source,
		code: "",
		resources: [...source.resources!, {
			id: "analysis/song.json", kind: "analysis", mimeType: "application/json", byteLength: 500,
			sha256: "d".repeat(64), attachmentKey: `programmatic-sha256-${"d".repeat(64)}`,
		}],
		recipe: {
			version: 1,
			root: "panels",
			songStartSeconds: 12.25,
			audio: { resource: "analysis/song.json", inputSha256: "e".repeat(64) },
			outputRoles: ["background"],
			nodes: [
				{
					id: "solid",
					scene: { kind: "illust", motion: { startFrame: 0, durationFrames: 90 }, easing: "linear", sprites: [{
						image: "images/original.png", role: "background", anchor: [0.5, 1], drawingFps: 12,
						from: { x: 0.5, y: 1, height: 0.8, rotation: 0, opacity: 1 },
						to: { x: 0.6, y: 1, height: 0.9, rotation: 0.1, opacity: 1 },
						enter: { span: { startFrame: 0, durationFrames: 8 }, easing: "outExpo", offset: [-0.2, 0], scale: 0.8, rotation: -0.1, opacity: 0 },
						exit: { span: { startFrame: 70, durationFrames: 8 }, easing: "inExpo", offset: [0.2, 0], scale: 1, rotation: 0, opacity: 0 },
						wave: { amplitude: 0.01, from: 0.3, cycles: 2.2, frequency: 0.5, phase: 0, strips: 32 },
						shadow: { color: [0, 0, 0, 0.5], offset: [0.03, 0], blur: 0.01 },
						rim: { color: [1, 0.7, 0.4, 1], offset: [-0.01, 0], blur: 0 },
						silhouette: [0.2, 0.4, 1, 1],
						glow: { color: [1, 0.7, 0.4, 0.5], offset: [0.1, -0.5], radius: 0.1 },
						audio: [{ target: "scale", amount: 0.1, signal: { kind: "envelope", channel: "mix_rms", clock: "source", missing: "zero" } }],
					}] },
				},
				{ id: "held", scene: { kind: "ref", input: "solid", timeMap: [{ atFrame: 0, sourceFrame: 8 }] } },
				{ id: "cut", scene: { kind: "sequence", items: [{ input: "held", span: { startFrame: 0, durationFrames: 90 }, timeMap: [{ atFrame: 0, sourceFrame: 0 }, { atFrame: 89, sourceFrame: 89 }] }] } },
				{ id: "panels", scene: { kind: "panels", panels: [{ input: "cut", polygon: [[0, 0], [1, 0], [1, 1], [0, 1]],
					opening: { span: { startFrame: 0, durationFrames: 1 }, angle: 0, easing: "linear" },
					camera: { motion: { startFrame: 0, durationFrames: 90 }, from: { x: 0, y: 0, zoom: 1 }, to: { x: 0, y: 0, zoom: 1 }, easing: "linear" },
				}] } },
			],
			post: [
				{
					roles: ["background"],
					audio: [{ effect: 0, amount: 0.2, signal: { kind: "beatPulse", decay: 8, clock: "song", missing: "zero" } }],
					effects: [
						{ kind: "grain", amount: 0.1, fps: 12 },
						{ kind: "lineBoil", amount: 2, cellSize: 34, fps: 12 },
						{ kind: "glitch", amount: 0.2, bands: 38, fps: 12 },
						{ kind: "chromaticAberration", amount: 2, center: [0.5, 0.5] },
						{ kind: "zoomBlur", amount: 0.1, center: [0.5, 0.5] },
						{ kind: "bloom", amount: 0.3, threshold: 0.72, radius: 4, alpha: "preserve" },
					],
				},
			],
		},
	};
	await f.automation.apply({
		expectedRevision: revisionOf(0),
		operations: [
			{
				kind: "create-track",
				track: {
					id: trackId("mv-track"),
					kind: "graphic",
					name: "MV",
					hidden: false,
				},
			},
			{
				kind: "create-clip",
				clip: {
					id: clipId("mv"),
					trackId: trackId("mv-track"),
					startTime: zero,
					duration: mediaTime({ ticks: 120000 }),
					trimStart: zero,
					trimEnd: zero,
					editing: { ...editing, programmatic: recipeSource },
				},
			},
		],
	});
	let reopened = await f.open();
	expect(
		(await reopened.automation.clips()).find((c) => c.id === "mv")?.editing
			?.programmatic,
	).toEqual(recipeSource);
	const stored = await f.store.load({ id: TEST_PROJECT_ID });
	const invalid: TransactionBatch = {
		expectedRevision: revisionOf(1),
		operations: [
			{
				kind: "update-clip",
				clipId: clipId("mv"),
				patch: {
					editing: {
						...editing,
						programmatic: {
							...recipeSource,
							recipe: { ...recipeSource.recipe!, root: "missing" },
						},
					},
				},
			},
		],
	};
	expect((await reopened.automation.dryRun(invalid)).accepted).toBe(false);
	await expect(reopened.automation.apply(invalid)).rejects.toThrow();
	expect(await f.store.load({ id: TEST_PROJECT_ID })).toEqual(stored);
	const invalidAudio: TransactionBatch = { expectedRevision: revisionOf(1), operations: [{
		kind: "update-clip", clipId: clipId("mv"), patch: { editing: { ...editing, programmatic: {
			...recipeSource, recipe: { ...recipeSource.recipe!, post: [{ roles: ["background"],
				effects: [{ kind: "grain", amount: 0.1, fps: 12 }],
				audio: [{ effect: 1, amount: 0.2, signal: { kind: "beatPulse", decay: 8, clock: "song", missing: "zero" } }],
			}] },
		} } },
	}] };
	expect((await reopened.automation.dryRun(invalidAudio)).accepted).toBe(false);
	await expect(reopened.automation.apply(invalidAudio)).rejects.toThrow();
	expect(await f.store.load({ id: TEST_PROJECT_ID })).toEqual(stored);
	await reopened.automation.apply({
		expectedRevision: revisionOf(1),
		operations: [
			{ kind: "update-clip", clipId: clipId("mv"), patch: { editing } },
		],
	});
	reopened = await f.open();
	expect(
		(await reopened.automation.clips()).find((c) => c.id === "mv")?.editing
			?.programmatic,
	).toEqual(source);
	expect(
		JSON.stringify(await f.store.load({ id: TEST_PROJECT_ID })),
	).not.toContain("songStartSeconds");
});

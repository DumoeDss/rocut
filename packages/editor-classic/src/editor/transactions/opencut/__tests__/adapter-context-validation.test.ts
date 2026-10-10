/* eslint-disable @typescript-eslint/no-unsafe-type-assertion, opencut/prefer-object-params -- Isolated wiring fixtures construct donor/contract brands and instrument validation; no native domain semantics are simulated. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, mock, test } from "bun:test";
import type { Clip, TransactionOperation } from "@opencut/editor-contracts";
import type { TransactionEngineDocument } from "@opencut/editor-contracts/engine";
import type { TScene, TextElement } from "../../../../timeline/types";

async function runContextChecks({ reproduction = false } = {}) {
	const requests: Record<string, unknown>[] = [];
	const wasmAttempts: string[] = [];
	let rejectSelected = true;
	const originalWasm = globalThis.WebAssembly;
	globalThis.WebAssembly = new Proxy(originalWasm, {
		get(target, property, receiver) {
			if (
				[
					"Module",
					"Instance",
					"compile",
					"instantiate",
					"compileStreaming",
					"instantiateStreaming",
				].includes(String(property))
			) {
				return () => {
					wasmAttempts.push(String(property));
					throw Error("Context wiring checks must not execute WASM");
				};
			}
			return Reflect.get(target, property, receiver);
		},
	});
	// Only the native validator/catalog and unrelated duration summary are doubles.
	// Adapter, projection/codec, request policy, engine and memory store are real.
	const boundary = () => ({
		validateClipEditingJson(input: string) {
			requests.push(JSON.parse(input) as Record<string, unknown>);
			return rejectSelected
				? '[{"path":"context","message":"Context observation rejection"}]'
				: "[]";
		},
		validateSceneStateJson: () => "[]",
		validateMasterEffectsJson: () => "[]",
		planSceneMutationJson: () => {
			throw Error("Unexpected scene planner call");
		},
	});
	mock.module(fileURLToPath(import.meta.resolve("opencut-wasm")), boundary);
	mock.module("opencut-wasm", boundary);
	mock.module(
		fileURLToPath(new URL("../editing-catalog.ts", import.meta.url)),
		() => ({
			editingCatalog: () => ({
				version: 1,
				effects: {},
				elements: {},
				graphics: {},
			}),
		}),
	);
	mock.module(
		fileURLToPath(new URL("../../../../timeline/scenes.ts", import.meta.url)),
		() => ({
			getProjectDurationFromScenes({ scenes }: { scenes: TScene[] }) {
				return Math.max(
					0,
					...scenes
						.flatMap((scene) => [
							scene.tracks.main,
							...scene.tracks.overlay,
							...scene.tracks.audio,
						])
						.flatMap((track) =>
							track.elements.map(
								(element) => element.startTime + element.duration,
							),
						),
				);
			},
		}),
	);
	const { createOpenCutTransactionDocumentAdapter } =
		await import("../adapter");
	const { validateDocumentEditing, openCutEditingPolicy } =
		await import("../editing-policy");
	const {
		projectFixture,
		recordFixture,
		storeFixture,
		motionTextSequenceFixture,
		TEST_PROJECT_ID,
	} = await import("./fixture");
	const { mediaTime, revisionOf, clipId, trackId, assetId } =
		await import("@opencut/editor-contracts");
	const { openTransactionEngine } =
		await import("@opencut/editor-contracts/engine");
	const ticks = (value: number) => value as TextElement["duration"];
	const project = projectFixture();
	project.motionTextSequences = [motionTextSequenceFixture()];
	const text = (id: string): TextElement => ({
		id,
		type: "text",
		name: id,
		startTime: ticks(0),
		duration: ticks(120000),
		trimStart: ticks(0),
		trimEnd: ticks(0),
		params: { content: "Context fixture" },
		effects: [],
		animations: {},
	});
	project.scenes[0].tracks.overlay.push(
		{
			id: "context-track",
			name: "Context",
			type: "text",
			hidden: false,
			elements: [text("context-probe")],
		},
		{
			id: "unchanged-track",
			name: "Unchanged",
			type: "text",
			hidden: false,
			elements: [text("unchanged-probe")],
		},
		{
			id: "same-kind-track",
			name: "Same kind",
			type: "text",
			hidden: false,
			elements: [],
		},
		{
			id: "other-kind-track",
			name: "Other kind",
			type: "graphic",
			hidden: false,
			elements: [],
		},
		{
			id: "effect-context-track",
			name: "Effect",
			type: "effect",
			hidden: false,
			elements: [],
		},
	);
	project.scenes[0].tracks.main.elements.push({
		id: "asset-probe",
		type: "video",
		name: "Asset",
		mediaId: "context-asset",
		startTime: ticks(0),
		duration: ticks(120000),
		trimStart: ticks(0),
		trimEnd: ticks(0),
		params: {},
	});
	const assets = [
		{
			id: "context-asset",
			name: "Context",
			type: "video" as const,
			duration: 480000,
		},
		{
			id: "same-kind-asset",
			name: "Same kind",
			type: "video" as const,
			duration: 480000,
		},
		{ id: "other-kind-asset", name: "Other kind", type: "image" as const },
	];
	const record = recordFixture(project, {
		opaqueSentinel: { retained: [1, "yes"] },
	});
	const originalRecord = structuredClone(record);
	function fixture({ provider = true } = {}) {
		const selected: string[][] = [];
		const adapter = createOpenCutTransactionDocumentAdapter({
			initialRecord: record,
			initialAssets: assets,
			...(provider
				? {
						validateEditing(
							args: Parameters<typeof validateDocumentEditing>[0],
						) {
							selected.push([...(args.ids ?? [])]);
							return validateDocumentEditing(args);
						},
					}
				: {}),
		});
		return {
			adapter,
			selected,
			document: adapter.decode({ projectId: TEST_PROJECT_ID, record }),
		};
	}
	const patchClip = (
		document: TransactionEngineDocument,
		id: string,
		patch: Partial<Clip>,
	) => ({
		...document,
		clips: document.clips.map((clip) =>
			clip.id === id ? { ...clip, ...patch } : clip,
		),
	});
	const cases: {
		name: string;
		id: string;
		expected: Record<string, unknown>;
		change(document: TransactionEngineDocument): TransactionEngineDocument;
	}[] = [
		{
			name: "trimStart",
			id: "context-probe",
			expected: { trimStart: 4000 },
			change: (d) =>
				patchClip(d, "context-probe", {
					trimStart: mediaTime({ ticks: 4000 }),
				}),
		},
		{
			name: "trackKind",
			id: "context-probe",
			expected: { trackKind: "graphic" },
			change: (d) => ({
				...d,
				tracks: d.tracks.map((track) =>
					track.id === "context-track" ? { ...track, kind: "graphic" } : track,
				),
			}),
		},
		{
			name: "trackReassignmentDifferentKind",
			id: "context-probe",
			expected: { trackKind: "graphic" },
			change: (d) =>
				patchClip(d, "context-probe", { trackId: trackId("other-kind-track") }),
		},
		{
			name: "missingTrack",
			id: "context-probe",
			expected: { trackKind: "missing" },
			change: (d) => ({
				...d,
				tracks: d.tracks.filter((track) => track.id !== "context-track"),
			}),
		},
		{
			name: "assetKind",
			id: "asset-probe",
			expected: { assetKind: "image" },
			change: (d) => ({
				...d,
				assets: d.assets.map((asset) =>
					asset.id === "context-asset" ? { ...asset, kind: "image" } : asset,
				),
			}),
		},
		{
			name: "assetReassignmentDifferentKind",
			id: "asset-probe",
			expected: { assetKind: "image" },
			change: (d) =>
				patchClip(d, "asset-probe", { assetId: assetId("other-kind-asset") }),
		},
		{
			name: "missingAsset",
			id: "asset-probe",
			expected: { assetKind: undefined },
			change: (d) => ({
				...d,
				assets: d.assets.filter((asset) => asset.id !== "context-asset"),
			}),
		},
		{
			name: "hasMotionText",
			id: "context-probe",
			expected: { hasMotionText: true },
			change: (d) =>
				patchClip(d, "context-probe", {
					content: {
						kind: "motion-text",
						sequenceId: project.motionTextSequences![0].id,
					},
				}),
		},
		{
			name: "hasAdjustment",
			id: "context-probe",
			expected: { hasAdjustment: true },
			change: (d) =>
				patchClip(d, "context-probe", {
					adjustment: {
						exposure: 0,
						contrast: 0,
						saturation: 0,
						temperature: 0,
						tint: 0,
					},
				}),
		},
	];
	const observations = [];
	try {
		for (const c of cases) {
			const { adapter, selected, document } = fixture();
			const candidate = {
				...c.change(document),
				revision: revisionOf(document.revision + 1),
			};
			// Demonstrate the real policy serializes this exact dependency before
			// testing whether the real unstaged adapter selects the affected clip.
			requests.length = 0;
			validateDocumentEditing({ document: candidate, ids: new Set([c.id]) });
			assert.equal(requests.length, 1);
			for (const [key, value] of Object.entries(c.expected))
				assert.equal(requests[0][key], value);
			const expectedRequest = structuredClone(requests[0]);
			requests.length = 0;
			const before = structuredClone(adapter.currentDraft());
			let error: unknown;
			try {
				adapter.encode({
					projectId: TEST_PROJECT_ID,
					previousRecord: record,
					document: candidate,
				});
			} catch (cause) {
				error = cause;
			}
			if (reproduction) {
				observations.push({
					name: c.name,
					policyRequest: expectedRequest,
					selected,
					nativeCalls: requests,
					threw: error instanceof Error ? error.message : null,
					receiptCreated: adapter.consumeReceipt() !== null,
				});
				continue;
			}
			assert(
				error instanceof Error &&
					/Context observation rejection/.test(error.message),
				c.name,
			);
			assert.deepEqual(selected, [[c.id]], c.name);
			assert.deepEqual(requests, [expectedRequest], c.name);
			assert.deepEqual(adapter.currentDraft(), before, c.name);
			assert.equal(adapter.consumeReceipt(), null, c.name);
			const absent = fixture({ provider: false });
			const absentBefore = structuredClone(absent.adapter.currentDraft());
			assert.throws(
				() =>
					absent.adapter.encode({
						projectId: TEST_PROJECT_ID,
						previousRecord: record,
						document: c.change(absent.document),
					}),
				/requires the runtime editing provider/,
				c.name,
			);
			assert.equal(absent.adapter.consumeReceipt(), null, c.name);
			assert.deepEqual(absent.adapter.currentDraft(), absentBefore, c.name);
		}
		if (reproduction) {
			console.log(
				JSON.stringify({
					kind: "before-context-selection",
					observations,
					wasmAttempts,
				}),
			);
			return;
		}
		// Request-equivalent metadata/references must not select unchanged clips.
		for (const change of [
			(d: TransactionEngineDocument) => d,
			(d: TransactionEngineDocument) =>
				patchClip(d, "context-probe", {
					startTime: mediaTime({ ticks: 1000 }),
					trimEnd: mediaTime({ ticks: 500 }),
				}),
			(d: TransactionEngineDocument) =>
				patchClip(d, "context-probe", { trackId: trackId("same-kind-track") }),
			(d: TransactionEngineDocument) =>
				patchClip(d, "asset-probe", { assetId: assetId("same-kind-asset") }),
			(d: TransactionEngineDocument) => ({
				...d,
				tracks: d.tracks.map((track) => ({ ...track, name: "Metadata only" })),
				assets: d.assets.map((asset) => ({ ...asset, name: "Metadata only" })),
			}),
		]) {
			const { adapter, selected, document } = fixture();
			requests.length = 0;
			adapter.encode({
				projectId: TEST_PROJECT_ID,
				previousRecord: record,
				document: change(document),
			});
			assert.deepEqual(selected, [[]]);
			assert.deepEqual(requests, []);
		}
		// Existing provider semantics remain authoritative for a legal context edit.
		{
			const { adapter, document } = fixture();
			rejectSelected = false;
			requests.length = 0;
			const encoded = adapter.encode({
				projectId: TEST_PROJECT_ID,
				previousRecord: record,
				document: cases[0].change(document),
			});
			assert.equal(
				adapter
					.decode({ projectId: TEST_PROJECT_ID, record: encoded.record })
					.clips.find((clip) => clip.id === "context-probe")?.trimStart,
				4000,
			);
			assert(adapter.consumeReceipt());
			rejectSelected = true;
		}
		const operations: TransactionOperation[] = [
			{
				kind: "update-clip",
				clipId: clipId("context-probe"),
				patch: { trimStart: mediaTime({ ticks: 4000 }) },
			},
			{
				kind: "update-track",
				trackId: trackId("context-track"),
				patch: { kind: "graphic" },
			},
			{
				kind: "update-clip",
				clipId: clipId("context-probe"),
				patch: { trackId: trackId("other-kind-track") },
			},
			{
				kind: "update-clip",
				clipId: clipId("asset-probe"),
				patch: { assetId: assetId("other-kind-asset") },
			},
			{
				kind: "update-clip",
				clipId: clipId("context-probe"),
				patch: {
					trackId: trackId("other-kind-track"),
					content: {
						kind: "motion-text",
						sequenceId: project.motionTextSequences![0].id,
					},
				},
			},
			{
				kind: "update-clip",
				clipId: clipId("context-probe"),
				patch: {
					trackId: trackId("effect-context-track"),
					adjustment: {
						exposure: 0,
						contrast: 0,
						saturation: 0,
						temperature: 0,
						tint: 0,
					},
				},
			},
		];
		for (const operation of operations)
			for (const placementPolicies of [[], [openCutEditingPolicy]]) {
				const stored = await storeFixture(project);
				const initial = await stored.store.load({ id: TEST_PROJECT_ID });
				assert(initial);
				const adapter = createOpenCutTransactionDocumentAdapter({
					initialRecord: initial,
					initialAssets: assets,
					validateEditing: validateDocumentEditing,
				});
				const engine = await openTransactionEngine({
					store: stored.store,
					projectId: TEST_PROJECT_ID,
					documentAdapter: adapter,
					placementPolicies,
				});
				const before = structuredClone(adapter.currentDraft());
				requests.length = 0;
				await assert.rejects(
					() => engine.apply({ operations: [operation] }),
					(error) => {
						assert(error instanceof Error);
						assert.match(
							error.message,
							placementPolicies.length
								? /Context observation rejection/
								: /adapter could not encode a valid replacement/,
							JSON.stringify(error),
						);
						return true;
					},
				);
				assert.equal(requests.length, 1, JSON.stringify(operation));
				assert.deepEqual(
					await stored.store.load({ id: TEST_PROJECT_ID }),
					initial,
				);
				assert.equal(stored.getSaveCount(), 0);
				assert.equal(adapter.consumeReceipt(), null);
				assert.deepEqual(adapter.currentDraft(), before);
			}
		assert.deepEqual(record, originalRecord);
		assert.deepEqual(wasmAttempts, []);
		console.log(
			"context-selection: 36 CPU wiring checks passed; no WASM executed",
		);
	} finally {
		globalThis.WebAssembly = originalWasm;
	}
}

if (process.argv.includes("--context-validation-child"))
	await runContextChecks();
else if (process.argv.includes("--context-reproduction-child"))
	await runContextChecks({ reproduction: true });
else
	test("unstaged adapter revalidates changed request context and leaves rejected state/save/receipt untouched", () => {
		const result = spawnSync(
			process.execPath,
			[fileURLToPath(import.meta.url), "--context-validation-child"],
			{ encoding: "utf8", windowsHide: true, timeout: 30000 },
		);
		expect(result.status, result.stderr).toBe(0);
		expect(result.stdout).toContain(
			"36 CPU wiring checks passed; no WASM executed",
		);
	}, 35000);

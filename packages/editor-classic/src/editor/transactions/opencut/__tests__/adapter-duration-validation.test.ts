import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, mock, test } from "bun:test";
import type { TransactionEngineDocument } from "@opencut/editor-contracts/engine";
import type { TextElement, TScene } from "../../../../timeline/types";

async function runIsolatedChecks() {
	const clipCalls: number[] = [];
	const wasmAttempts: string[] = [];
	let rejectSelectedClip = false;
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
				return function forbiddenWasm() {
					wasmAttempts.push(String(property));
					throw new Error("This wiring regression must not execute WASM");
				};
			}
			return Reflect.get(target, property, receiver);
		},
	});
	// These boundaries observe caller selection, not Rust validation semantics.
	const boundary = () => ({
		validateClipEditingJson(input: string) {
			const request: unknown = JSON.parse(input);
			assert(request && typeof request === "object" && "duration" in request);
			assert.equal(typeof request.duration, "number");
			if (typeof request.duration !== "number")
				throw new Error("Missing duration");
			clipCalls.push(request.duration);
			return JSON.stringify(
				rejectSelectedClip || request.duration === 0
					? [
							{
								path: "duration",
								message: "Selected clip rejected by observation seam",
							},
						]
					: [],
			);
		},
		validateSceneStateJson: () => "[]",
		validateMasterEffectsJson: () => "[]",
		planSceneMutationJson: () => {
			throw new Error("Unexpected scene planner call");
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
	// Avoid unrelated timeline barrel/runtime imports; the adapter under test is real.
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
	const { projectFixture, recordFixture, storeFixture, TEST_PROJECT_ID } =
		await import("./fixture");
	const { mediaTime, revisionOf, clipId } =
		await import("@opencut/editor-contracts");
	const { openTransactionEngine } =
		await import("@opencut/editor-contracts/engine");
	const project = projectFixture();
	const nativeTime = ({ ticks }: { ticks: number }) => {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Fixed integer fixture ticks use the native donor brand without initializing its WASM module.
		return ticks as TextElement["duration"];
	};
	project.scenes[0].tracks.overlay.push({
		id: "duration-probe-track",
		name: "Probe",
		type: "text",
		hidden: false,
		elements: ["duration-probe", "unchanged-probe"].map((id, index) => ({
			id,
			type: "text",
			name: "Duration regression",
			startTime: nativeTime({ ticks: index * 480000 }),
			duration: nativeTime({ ticks: 120000 }),
			trimStart: nativeTime({ ticks: 0 }),
			trimEnd: nativeTime({ ticks: 0 }),
			params: { content: "Dedicated regression" },
			effects: [],
			animations: {},
		})),
	});
	const record = recordFixture(project);
	const originalRecord = structuredClone(record);
	function fixture({ withProvider = true }: { withProvider?: boolean } = {}) {
		const selected: string[][] = [];
		const adapter = createOpenCutTransactionDocumentAdapter({
			initialRecord: record,
			initialAssets: [],
			...(withProvider
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
	function change({
		document,
		duration,
		editName = false,
	}: {
		document: TransactionEngineDocument;
		duration: number;
		editName?: boolean;
	}): TransactionEngineDocument {
		return {
			...document,
			revision: revisionOf(document.revision + 1),
			clips: document.clips.map((clip) => {
				if (clip.id !== "duration-probe") return clip;
				assert(clip.editing);
				return {
					...clip,
					duration: mediaTime({ ticks: duration }),
					editing: editName
						? { ...clip.editing, name: "Changed editing" }
						: clip.editing,
				};
			}),
		};
	}
	try {
		for (const duration of [60000, 240000]) {
			const { adapter, selected, document } = fixture();
			clipCalls.length = 0;
			const encoded = adapter.encode({
				projectId: TEST_PROJECT_ID,
				previousRecord: record,
				document: change({ document, duration }),
			});
			assert.deepEqual(selected, [["duration-probe"]]);
			assert.deepEqual(clipCalls, [duration]);
			const reopened = adapter.decode({
				projectId: TEST_PROJECT_ID,
				record: encoded.record,
			});
			assert.equal(
				reopened.clips.find((clip) => clip.id === "duration-probe")?.duration,
				duration,
			);
			assert(adapter.consumeReceipt());
		}
		for (const editName of [false, true]) {
			const { adapter, selected, document } = fixture();
			clipCalls.length = 0;
			assert.throws(
				() =>
					adapter.encode({
						projectId: TEST_PROJECT_ID,
						previousRecord: record,
						document: change({ document, duration: 0, editName }),
					}),
				/Selected clip rejected/,
			);
			assert.deepEqual(selected, [["duration-probe"]]);
			assert.deepEqual(clipCalls, [0]);
			assert.equal(adapter.consumeReceipt(), null);
			assert.equal(
				adapter.currentDraft().project.scenes[0].tracks.overlay[0].elements[0]
					.duration,
				120000,
			);
		}
		{
			const { adapter, selected, document } = fixture();
			clipCalls.length = 0;
			adapter.encode({
				projectId: TEST_PROJECT_ID,
				previousRecord: record,
				document,
			});
			assert.deepEqual(selected, [[]]);
			assert.deepEqual(clipCalls, []);
		}
		for (const duration of [60000, 240000, 0]) {
			const { adapter, document } = fixture({ withProvider: false });
			assert.throws(
				() =>
					adapter.encode({
						projectId: TEST_PROJECT_ID,
						previousRecord: record,
						document: change({ document, duration }),
					}),
				/requires the runtime editing provider/,
			);
			assert.equal(adapter.consumeReceipt(), null);
		}
		{
			const stored = await storeFixture(project);
			const initial = await stored.store.load({ id: TEST_PROJECT_ID });
			assert(initial);
			const adapter = createOpenCutTransactionDocumentAdapter({
				initialRecord: initial,
				initialAssets: [],
				validateEditing: validateDocumentEditing,
			});
			const engine = await openTransactionEngine({
				store: stored.store,
				projectId: TEST_PROJECT_ID,
				documentAdapter: adapter,
				placementPolicies: [openCutEditingPolicy],
			});
			clipCalls.length = 0;
			rejectSelectedClip = true;
			await assert.rejects(() =>
				engine.apply({
					operations: [
						{
							kind: "update-clip",
							clipId: clipId("duration-probe"),
							patch: { duration: mediaTime({ ticks: 60000 }) },
						},
					],
				}),
			);
			assert.deepEqual(clipCalls, [60000]);
			assert.deepEqual(
				await stored.store.load({ id: TEST_PROJECT_ID }),
				initial,
			);
			assert.equal(stored.getSaveCount(), 0);
			assert.equal(adapter.consumeReceipt(), null);
		}
		assert.deepEqual(record, originalRecord);
		assert.deepEqual(wasmAttempts, []);
		console.log(
			"duration-selection: 9 CPU wiring checks passed; no WASM executed",
		);
	} finally {
		globalThis.WebAssembly = originalWasm;
	}
}

if (process.argv.includes("--duration-validation-child")) {
	await runIsolatedChecks();
} else {
	test("unstaged duration edits use the existing provider without selecting unchanged clips", () => {
		// Keep module mocks out of the parent runner and every neighboring test file.
		const result = spawnSync(
			process.execPath,
			[fileURLToPath(import.meta.url), "--duration-validation-child"],
			{
				encoding: "utf8",
				windowsHide: true,
				timeout: 30000,
			},
		);
		expect(result.status, result.stderr).toBe(0);
		expect(result.stdout).toContain(
			"9 CPU wiring checks passed; no WASM executed",
		);
	}, 35000);
}

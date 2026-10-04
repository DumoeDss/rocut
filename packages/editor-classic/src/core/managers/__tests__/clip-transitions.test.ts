import { describe, expect, test } from "bun:test";
import {
	clipId,
	mediaTime as contractTime,
	type TransactionBatch,
} from "@opencut/editor-contracts";
import { commandHarness } from "./command-test-harness";
import type { MediaAsset } from "../../../media/types";
import type { ImageElement, VideoElement } from "../../../timeline/types";
const {
	UpdateElementsCommand,
	DeleteElementsCommand,
	DuplicateElementsCommand,
} = await import("../../../commands");
const { projectFixture, TEST_PROJECT_ID } =
	await import("../../../editor/transactions/opencut/__tests__/fixture");
const { decodeProject } =
	await import("../../../editor/persistence/project-codec");
const { mediaTime } = await import("../../../wasm");
const t = (ticks: number) => mediaTime({ ticks });
const transition = {
	kind: "cross-dissolve" as const,
	outgoingClipId: "left",
	durationFrames: 30,
};

async function setup({
	video = false,
	single = false,
}: { video?: boolean; single?: boolean } = {}) {
	const asset: MediaAsset = {
		id: "source",
		name: "source",
		type: video ? "video" : "image",
		file: new File([], video ? "source.mp4" : "source.png"),
		...(video ? { duration: 10, hasAudio: true } : {}),
	};
	const project = projectFixture();
	const elements: (VideoElement | ImageElement)[] = ["left", "right"]
		.slice(0, single ? 1 : 2)
		.map((id, index) => ({
			id,
			name: id,
			type: video ? ("video" as const) : ("image" as const),
			mediaId: asset.id,
			startTime: t(index * 240000),
			duration: t(240000),
			trimStart: t(video ? 120000 : 0),
			trimEnd: t(video && single ? 840000 : 0),
			...(video ? { sourceDuration: t(1200000) } : {}),
			params: { opacity: 0.8 },
		}));
	project.scenes[0].tracks.main.elements = elements;
	const h = await commandHarness(project, [asset]);
	return {
		...h,
		asset,
		clips: () => h.getScenes()[0].tracks.main.elements,
		persisted: async () =>
			decodeProject((await h.fixture.store.load({ id: TEST_PROJECT_ID }))?.data)
				.scenes[0].tracks.main.elements,
	};
}
function edit({
	patch,
	id = "right",
}: {
	patch: Partial<VideoElement | ImageElement>;
	id?: string;
}) {
	return new UpdateElementsCommand({
		updates: [{ trackId: "main-track", elementId: id, patch }],
	});
}
function apiEdit({
	patch,
	id = "right",
}: {
	patch: Extract<
		TransactionBatch["operations"][number],
		{ kind: "update-clip" }
	>["patch"];
	id?: string;
}): TransactionBatch {
	return { operations: [{ kind: "update-clip", clipId: clipId(id), patch }] };
}
const publicTransition = { ...transition, outgoingClipId: clipId("left") };

describe("durable incoming transitions and authoritative playback rate", () => {
	test("adds, changes, clears, undoes and redoes a relation without losing donor state", async () => {
		const h = await setup();
		const original = structuredClone(h.clips());
		await h.command.execute({
			command: edit({ patch: { transitionIn: transition } }),
		});
		expect(h.fixture.getSaveCount()).toBe(1);
		expect(h.clips()[1]).toEqual({ ...original[1], transitionIn: transition });
		expect(await h.persisted()).toEqual(h.clips());
		expect((await h.transactions.clips())[1].transitionIn).toEqual(
			publicTransition,
		);
		await h.command.execute({
			command: edit({
				patch: { transitionIn: { ...transition, durationFrames: 16 } },
			}),
		});
		expect(h.clips()[1].transitionIn?.durationFrames).toBe(16);
		await h.command.undo();
		expect(h.clips()[1].transitionIn).toEqual(transition);
		await h.command.redo();
		expect(h.clips()[1].transitionIn?.durationFrames).toBe(16);
		await h.command.execute({
			command: edit({ patch: { transitionIn: undefined } }),
		});
		expect((await h.persisted())[1].transitionIn).toBeUndefined();
		await h.command.undo();
		expect(h.clips()[1].transitionIn?.durationFrames).toBe(16);
		await h.command.redo();
		expect(h.clips()[1].transitionIn).toBeUndefined();
		await h.transactions.open({
			projectId: TEST_PROJECT_ID,
			assets: [h.asset],
		});
		expect((await h.transactions.clips())[1].transitionIn).toBeUndefined();
	});

	test("save failure never publishes a partial relation or history entry", async () => {
		const h = await setup();
		const original = structuredClone(h.clips());
		h.fixture.control.failNext({
			operation: "save-project",
			code: "unavailable",
		});
		await expect(
			h.command.execute({
				command: edit({ patch: { transitionIn: transition } }),
			}),
		).rejects.toBeDefined();
		expect(h.clips()).toEqual(original);
		expect(await h.persisted()).toEqual(original);
		expect(h.command.getHistoryCount()).toBe(0);
		await h.command.execute({
			command: edit({ patch: { transitionIn: transition } }),
		});
		expect(h.clips()[1].transitionIn).toEqual(transition);
		await h.transactions.open({
			projectId: TEST_PROJECT_ID,
			assets: [h.asset],
		});
		expect((await h.transactions.clips())[1].transitionIn).toEqual(
			publicTransition,
		);
	});

	test("validate, dryRun and apply reject the same unavailable source handles", async () => {
		const h = await setup({ video: true });
		const bad = apiEdit({
			patch: {
				transitionIn: publicTransition,
				trimStart: contractTime({ ticks: 0 }),
			},
		});
		const validation = await h.transactions.validate(bad);
		const preview = await h.transactions.dryRun(bad);
		expect(validation.valid).toBe(false);
		expect(preview.accepted).toBe(false);
		if (validation.valid || preview.accepted)
			throw Error("invalid transition accepted");
		expect(preview.issues).toEqual(validation.issues);
		expect(
			validation.issues.some((issue) =>
				issue.message.includes("missing-incoming-handle"),
			),
		).toBe(true);
		await expect(h.transactions.apply(bad)).rejects.toBeDefined();
		expect(h.fixture.getSaveCount()).toBe(0);
		expect(h.clips()[1].transitionIn).toBeUndefined();
	});

	test("retimed handle validation reads the candidate public rate and preserves prior state", async () => {
		const h = await setup({ video: true });
		await h.transactions.apply(
			apiEdit({ patch: { transitionIn: publicTransition } }),
		);
		const before = structuredClone(h.clips());
		const bad = apiEdit({
			patch: { retime: { rate: 4, maintainPitch: true } },
		});
		const result = await h.transactions.validate(bad);
		expect(result.valid).toBe(false);
		if (result.valid) throw Error("missing retimed preroll accepted");
		expect(
			result.issues.some((issue) =>
				issue.message.includes("missing-incoming-handle"),
			),
		).toBe(true);
		await expect(h.transactions.apply(bad)).rejects.toBeDefined();
		expect(h.clips()).toEqual(before);
		await h.transactions.apply(
			apiEdit({ patch: { retime: { rate: 0.5, maintainPitch: true } } }),
		);
		expect((await h.transactions.clips())[1].retime).toEqual({
			rate: 0.5,
			maintainPitch: true,
		});
		expect(await h.persisted()).toEqual(h.clips());
	});

	test("a deletion must clear incoming references in the same public batch", async () => {
		const h = await setup();
		await h.transactions.apply(
			apiEdit({ patch: { transitionIn: publicTransition } }),
		);
		const deletion: TransactionBatch = {
			operations: [{ kind: "delete-clip", clipId: clipId("left") }],
		};
		expect((await h.transactions.validate(deletion)).valid).toBe(false);
		await expect(h.transactions.apply(deletion)).rejects.toBeDefined();
		expect(h.clips()).toHaveLength(2);
		await h.transactions.apply({
			operations: [
				...deletion.operations,
				{
					kind: "update-clip",
					clipId: clipId("right"),
					patch: { transitionIn: null },
				},
			],
		});
		expect(h.clips()).toHaveLength(1);
		expect(h.clips()[0].transitionIn).toBeUndefined();
		expect(await h.persisted()).toEqual(h.clips());
	});

	test("slow playback is durable, undoable and not mistaken for source overflow", async () => {
		const h = await setup({ video: true, single: true });
		const original = structuredClone(h.clips());
		await h.command.execute({
			command: edit({
				patch: { retime: { rate: 0.5, maintainPitch: true } },
				id: "left",
			}),
		});
		expect(h.clips()[0].duration).toBe(480000);
		expect((await h.transactions.clips())[0].retime).toEqual({
			rate: 0.5,
			maintainPitch: true,
		});
		expect(await h.persisted()).toEqual(h.clips());
		await h.command.undo();
		expect(h.clips()).toEqual(original);
		await h.command.redo();
		expect(h.clips()[0].duration).toBe(480000);
		await h.transactions.open({
			projectId: TEST_PROJECT_ID,
			assets: [h.asset],
		});
		expect((await h.transactions.clips())[0].retime?.rate).toBe(0.5);
		await h.transactions.apply(
			apiEdit({
				patch: { retime: null, duration: contractTime({ ticks: 240000 }) },
				id: "left",
			}),
		);
		expect((await h.persisted())[0]).toEqual(original[0]);
	});

	test("source overflow fails but an explicit frame hold can extend past source duration", async () => {
		const h = await setup({ video: true, single: true });
		const long = apiEdit({
			patch: {
				duration: contractTime({ ticks: 2400000 }),
				retime: { rate: 0.5 },
			},
			id: "left",
		});
		expect((await h.transactions.validate(long)).valid).toBe(false);
		await expect(h.transactions.apply(long)).rejects.toBeDefined();
		await h.transactions.apply(
			apiEdit({
				patch: {
					duration: contractTime({ ticks: 2400000 }),
					freezeFrame: contractTime({ ticks: 120000 }),
				},
				id: "left",
			}),
		);
		expect((await h.persisted())[0].duration).toBe(2400000);
	});

	test("ordinary move cleans the relation in the same history entry", async () => {
		const h = await setup();
		await h.command.execute({
			command: edit({ patch: { transitionIn: transition } }),
		});
		const before = structuredClone(h.clips());
		await h.command.execute({
			command: edit({ patch: { startTime: t(300000) } }),
		});
		expect(h.clips()[1].transitionIn).toBeUndefined();
		expect(h.clips()[1].startTime).toBe(300000);
		expect(await h.persisted()).toEqual(h.clips());
		await h.command.undo();
		expect(h.clips()).toEqual(before);
		await h.command.redo();
		expect(h.clips()[1].transitionIn).toBeUndefined();
	});

	test("deleting the outgoing clip cleans references atomically and undo restores both", async () => {
		const h = await setup();
		await h.command.execute({
			command: edit({ patch: { transitionIn: transition } }),
		});
		const before = structuredClone(h.clips());
		await h.command.execute({
			command: new DeleteElementsCommand({
				elements: [{ trackId: "main-track", elementId: "left" }],
			}),
		});
		expect(h.clips()).toHaveLength(1);
		expect(h.clips()[0].transitionIn).toBeUndefined();
		await h.command.undo();
		expect(h.clips()).toEqual(before);
		await h.command.redo();
		expect(await h.persisted()).toEqual(h.clips());
	});

	test("incoming split and duplicate discard copied links without destroying the original", async () => {
		const h = await setup();
		await h.command.execute({
			command: edit({ patch: { transitionIn: transition } }),
		});
		const before = structuredClone(h.clips());
		await h.timeline.splitElements({
			elements: [{ trackId: "main-track", elementId: "right" }],
			splitTime: t(360000),
			retainSide: "both",
		});
		expect(h.clips()).toHaveLength(3);
		expect(h.clips().find((clip) => clip.id === "right")?.transitionIn).toEqual(
			transition,
		);
		expect(h.clips().filter((clip) => clip.transitionIn)).toHaveLength(1);
		await h.command.undo();
		expect(h.clips()).toEqual(before);
		await h.command.execute({
			command: new DuplicateElementsCommand({
				elements: [{ trackId: "main-track", elementId: "right" }],
			}),
		});
		expect(h.clips().find((clip) => clip.id === "right")?.transitionIn).toEqual(
			transition,
		);
		const tracks = h.getScenes()[0].tracks;
		expect(
			[tracks.main, ...tracks.overlay]
				.flatMap((track) => track.elements)
				.filter((clip) => "transitionIn" in clip && clip.transitionIn),
		).toHaveLength(1);
		await h.command.undo();
		expect(h.clips()).toEqual(before);
	});

	test("save failure rolls back geometry and automatic relation cleanup together", async () => {
		const h = await setup();
		await h.command.execute({
			command: edit({ patch: { transitionIn: transition } }),
		});
		const before = structuredClone(h.clips());
		const history = h.command.getHistoryCount();
		h.fixture.control.failNext({
			operation: "save-project",
			code: "unavailable",
		});
		await expect(
			h.command.execute({ command: edit({ patch: { startTime: t(300000) } }) }),
		).rejects.toBeDefined();
		expect(h.clips()).toEqual(before);
		expect(await h.persisted()).toEqual(before);
		expect(h.command.getHistoryCount()).toBe(history);
	});

	test("splitting the outgoing clip removes its now non-adjacent relation and undo restores it", async () => {
		const h = await setup();
		await h.command.execute({
			command: edit({ patch: { transitionIn: transition } }),
		});
		const before = structuredClone(h.clips());
		await h.timeline.splitElements({
			elements: [{ trackId: "main-track", elementId: "left" }],
			splitTime: t(120000),
			retainSide: "both",
		});
		expect(h.clips()).toHaveLength(3);
		expect(h.clips().some((clip) => clip.transitionIn)).toBe(false);
		expect(await h.persisted()).toEqual(h.clips());
		await h.command.undo();
		expect(h.clips()).toEqual(before);
	});

	test("an invalid explicit change to an existing relation preserves it and its history", async () => {
		const h = await setup();
		await h.command.execute({
			command: edit({ patch: { transitionIn: transition } }),
		});
		const before = structuredClone(h.clips());
		const history = h.command.getHistoryCount();
		await expect(
			h.command.execute({
				command: edit({
					patch: { transitionIn: { ...transition, durationFrames: 9999 } },
				}),
			}),
		).rejects.toBeDefined();
		expect(h.clips()).toEqual(before);
		expect(await h.persisted()).toEqual(before);
		expect(h.command.getHistoryCount()).toBe(history);
	});

	test("media removal clears all affected clips and failure preserves the relation", async () => {
		const h = await setup();
		await h.command.execute({
			command: edit({ patch: { transitionIn: transition } }),
		});
		const before = structuredClone(h.clips());
		h.fixture.control.failNext({
			operation: "save-project",
			code: "unavailable",
		});
		await expect(
			h.command.removeMediaAssetReferences({ assetId: h.asset.id }),
		).rejects.toBeDefined();
		expect(h.clips()).toEqual(before);
		expect(await h.persisted()).toEqual(before);
		await h.command.removeMediaAssetReferences({ assetId: h.asset.id });
		expect(h.clips()).toEqual([]);
		expect(await h.persisted()).toEqual([]);
	});

	test("invalid UI transition parameters never become a saved no-op", async () => {
		const h = await setup();
		await expect(
			h.command.execute({
				command: edit({
					patch: {
						transitionIn: { ...transition, durationFrames: 9999 },
					},
				}),
			}),
		).rejects.toBeDefined();
		expect(h.fixture.getSaveCount()).toBe(0);
		expect(h.command.getHistoryCount()).toBe(0);
		await h.command.execute({
			command: edit({ patch: { transitionIn: transition } }),
		});
		await h.transactions.apply({
			operations: [
				{
					kind: "update-track",
					trackId: (await h.transactions.tracks())[0].id,
					patch: { hidden: true },
				},
			],
		});
		expect(h.clips()[1].transitionIn).toEqual(transition);
	});
});

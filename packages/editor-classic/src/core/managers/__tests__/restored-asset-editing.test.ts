import { expect, spyOn, test } from "bun:test";
import { toast } from "sonner";
import { commandHarness } from "./command-test-harness";
import { projectFixture } from "../../../editor/transactions/opencut/__tests__/fixture";
import { mergeAssetCatalogs } from "../../../editor/transactions/opencut/asset-catalog";
import { ToggleTrackMuteCommand } from "../../../commands/timeline/track/toggle-track-mute";
import { ToggleTrackVisibilityCommand } from "../../../commands/timeline/track/toggle-track-visibility";
import { MoveOverlayTrackCommand } from "../../../commands/timeline/track/move-overlay-track";
import type { OpenCutAssetCatalogEntry } from "../../../editor/transactions/opencut/types";
import type { MediaAsset } from "../../../media/types";
import { mediaTimeFromSeconds } from "../../../wasm";

const legacy: OpenCutAssetCatalogEntry = {
	id: "video",
	name: "shot.mp4",
	type: "video",
	duration: 2,
	hasAudio: false,
};
const restored: MediaAsset = {
	...legacy,
	sourceSha256: "a".repeat(64),
	file: new File([], "shot.mp4", { type: "video/mp4" }),
};

test("reopened legacy assets with newly learned hashes do not block mute, visibility or history", async () => {
	const h = await commandHarness(projectFixture(), [restored], {
		committedAssetCatalog: [legacy],
	});
	try {
		await h.command.execute({
			command: new ToggleTrackMuteCommand("main-track"),
		});
		await h.command.execute({
			command: new ToggleTrackVisibilityCommand("main-track"),
		});
		expect(h.getScenes()[0].tracks.main).toMatchObject({
			muted: true,
			hidden: true,
		});
		expect(await h.transactions.revision()).toBe(2);
		await h.command.undo();
		expect(h.getScenes()[0].tracks.main.hidden).toBe(false);
		await h.command.redo();
		expect(h.getScenes()[0].tracks.main.hidden).toBe(true);
		await h.transactions.retire();
		await h.transactions.open({
			projectId: h.getProject().metadata.id,
			assets: [restored],
		});
		expect(await h.transactions.revision()).toBe(4);
		expect((await h.transactions.tracks())[0]).toMatchObject({
			muted: true,
			hidden: true,
		});
		const record = await h.fixture.store.load({
			id: h.getProject().metadata.id,
		});
		expect(record?.data).toHaveProperty("__opencutTransaction.assetCatalog", [
			legacy,
		]);
		expect(h.failures).toEqual([]);
	} finally {
		await h.transactions.dispose();
	}
});

test("committed metadata stays authoritative while genuinely new assets are admitted", () => {
	const committed = { ...legacy, sourceSha256: "a".repeat(64) };
	const live = { ...legacy, name: "restored display name", duration: 2.00001 };
	const added = { ...legacy, id: "new-video" };
	const merged = mergeAssetCatalogs({
		committed: [committed],
		live: [live, added],
	});
	expect(merged).toEqual([committed, added]);
	expect(merged[0]).not.toBe(committed);
});

test("legacy projects can move a lyrics layer above video and undo across reopening", async () => {
	const project = projectFixture();
	project.scenes[0].tracks.overlay = ["shots", "lyrics"].map((id) => ({
		id,
		name: id,
		type: "text",
		hidden: false,
		elements: [
			{
				id: `${id}-title`,
				name: id,
				type: "text",
				params: { content: id },
				startTime: mediaTimeFromSeconds({ seconds: 0 }),
				duration: mediaTimeFromSeconds({ seconds: 1 }),
				trimStart: mediaTimeFromSeconds({ seconds: 0 }),
				trimEnd: mediaTimeFromSeconds({ seconds: 0 }),
			},
		],
	}));
	const h = await commandHarness(project, [restored], {
		committedAssetCatalog: [legacy],
	});
	const order = () => h.getScenes()[0].tracks.overlay.map((track) => track.id);
	try {
		await h.command.execute({
			command: new MoveOverlayTrackCommand({
				trackId: "lyrics",
				direction: "up",
			}),
		});
		expect(order()).toEqual(["lyrics", "shots"]);
		await h.command.undo();
		expect(order()).toEqual(["shots", "lyrics"]);
		await h.command.redo();
		expect(order()).toEqual(["lyrics", "shots"]);
		await h.transactions.retire();
		await h.transactions.open({
			projectId: project.metadata.id,
			assets: [restored],
		});
		expect((await h.transactions.tracks()).map((track) => track.id)).toEqual([
			"lyrics",
			"shots",
			"main-track",
		]);
		const saves = h.fixture.getSaveCount();
		for (const trackId of ["lyrics", "main-track", "missing"]) {
			await expect(
				h.command.execute({
					command: new MoveOverlayTrackCommand({ trackId, direction: "up" }),
				}),
			).rejects.toThrow();
		}
		expect(h.fixture.getSaveCount()).toBe(saves);
		expect(h.getScenes()[0].tracks.main.id).toBe("main-track");
	} finally {
		await h.transactions.dispose();
	}
});

test.each([
	{ ...restored, sourceSha256: "b".repeat(64) },
	{ ...restored, type: "audio" as const },
])(
	"known asset identity conflicts still refuse the entire edit",
	async (asset) => {
		const h = await commandHarness(projectFixture(), [asset], {
			committedAssetCatalog: [{ ...legacy, sourceSha256: "a".repeat(64) }],
		});
		const notice = spyOn(toast, "error").mockImplementation(
			() => "test-notice",
		);
		try {
			const saves = h.fixture.getSaveCount();
			await expect(
				h.command.execute({
					command: new ToggleTrackMuteCommand("main-track"),
				}),
			).rejects.toMatchObject({ code: "conflict" });
			expect(h.fixture.getSaveCount()).toBe(saves);
			expect(h.getScenes()[0].tracks.main.muted).toBe(false);
			expect(await h.transactions.revision()).toBe(0);
			expect(notice).toHaveBeenCalledWith(
				"Could not apply edit",
				expect.objectContaining({ id: "editor-command-failure" }),
			);
		} finally {
			notice.mockRestore();
			await h.transactions.dispose();
		}
	},
);

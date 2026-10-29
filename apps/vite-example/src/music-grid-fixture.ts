import type { EditorCore } from "../../../packages/editor-classic/src/core";
import { InsertElementCommand } from "../../../packages/editor-classic/src/commands/timeline/element/insert-element";
import { UpdateElementsCommand } from "../../../packages/editor-classic/src/commands/timeline/element/update-elements";
import { buildElementFromMedia } from "../../../packages/editor-classic/src/timeline/element-utils";
import { mediaTime } from "@opencut/editor-classic";
import { editMusicGrid, queryMusicGrid } from "@opencut/editor-classic/editing";

/** Disposable dev-only data, real source bytes, Rust planner and normal transaction/save owner. */
export async function installMusicGridFixture({
	editor,
	projectId,
}: {
	editor: EditorCore;
	projectId: string;
}) {
	const samples = 8 * 8000;
	const bytes = new ArrayBuffer(44 + samples * 2);
	const view = new DataView(bytes);
	const text = ({ at, value }: { at: number; value: string }) =>
		[...value].forEach((character, index) =>
			view.setUint8(at + index, character.charCodeAt(0)),
		);
	text({ at: 0, value: "RIFF" });
	view.setUint32(4, bytes.byteLength - 8, true);
	text({ at: 8, value: "WAVE" });
	text({ at: 12, value: "fmt " });
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, 8000, true);
	view.setUint32(28, 16000, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	text({ at: 36, value: "data" });
	view.setUint32(40, samples * 2, true);
	const file = new File([bytes], "reviewed-fixture-song.wav", {
		type: "audio/wav",
	});
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	const sha256 = Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
	const asset = await editor.media.addMediaAsset({
		projectId,
		asset: {
			file,
			name: file.name,
			type: "audio",
			duration: 8,
			hasAudio: true,
			sourceSha256: sha256,
		},
	});
	if (!asset) throw Error("Music fixture source import failed");
	const command = new InsertElementCommand({
		element: buildElementFromMedia({
			mediaId: asset.id,
			mediaType: "audio",
			name: file.name,
			duration: mediaTime({ ticks: 960000 }),
			startTime: mediaTime({ ticks: 0 }),
		}),
		placement: { mode: "auto", trackType: "audio" },
	});
	await editor.command.execute({ command });
	const clipId = command.getElementId();
	const trackId = command.getTrackId();
	if (!trackId) throw Error("Music fixture clip insertion failed");
	const sourceAvailability = async ({
		assetId,
		sourceSha256,
	}: {
		assetId: string;
		sourceSha256: string;
	}) => {
		const current = editor.media
			.getAssets()
			.find((entry) => entry.id === assetId);
		if (!current?.file) return "unavailable" as const;
		const digest = await crypto.subtle.digest(
			"SHA-256",
			await current.file.arrayBuffer(),
		);
		const hash = Array.from(new Uint8Array(digest), (byte) =>
			byte.toString(16).padStart(2, "0"),
		).join("");
		return hash === sourceSha256
			? ("available" as const)
			: ("unavailable" as const);
	};
	const created = await editMusicGrid({
		engine: editor.transactions,
		sourceAvailability,
		request: {
			expectedNativeRevision: await editor.transactions.revision(),
			idempotencyKey: "music-fixture-grid",
			operation: {
				kind: "create-manual",
				clipId,
				reviewReference: "fixture:manual-review",
				points: Array.from({ length: 16 }, (_, index) => ({
					id: `beat-${index}`,
					sourceTick: index * 60000,
					downbeat: index % 4 === 0,
				})),
			},
		},
	});
	if (created.status !== "applied")
		throw Error(`Music fixture grid rejected: ${JSON.stringify(created)}`);
	const project = await editor.transactions.project();
	const binding = project?.musicGridState?.bindings.find(
		(row) => row.clipId === clipId,
	);
	const grid = project?.musicGridState?.grids.find(
		(row) => row.id === binding?.gridId,
	);
	if (!binding || !grid) throw Error("Music fixture binding missing");
	const structure = await editMusicGrid({
		engine: editor.transactions,
		sourceAvailability,
		request: {
			expectedNativeRevision: await editor.transactions.revision(),
			idempotencyKey: "music-fixture-meter",
			operation: {
				kind: "replace-structure",
				gridId: grid.id,
				expectedGridRevision: grid.revision,
				reviewReference: "fixture:meter-review",
				meterSegments: [
					{
						id: "four-four",
						sourceStartTick: 0,
						sourceEndTick: 960000,
						meter: { numerator: 4, denominator: 4 },
						beatUnit: { numerator: 1, denominator: 4 },
						phaseQuarterNotes: { numerator: 0, denominator: 1 },
						barNumber: 1,
					},
				],
			},
		},
	});
	if (structure.status !== "applied")
		throw Error(`Music fixture meter rejected: ${JSON.stringify(structure)}`);
	const originalVisual = await editor.transactions.clips();
	const resource = {
		schema: "creator-music-anchors/1",
		clock: "source-audio-ticks",
		kind: "sections",
		source: { assetId: asset.id, versionId: "fixture-source-version", sha256 },
		reviewReference: "fixture:section-review",
		anchors: [
			{
				key: "verse",
				label: "Verse reviewed",
				sourceTick: 120000,
				endSourceTick: 360000,
			},
			{
				key: "tail",
				label: "Tail reviewed",
				sourceTick: 840000,
				endSourceTick: 960000,
			},
		],
	};
	return {
		bindingId: binding.id,
		resource,
		async moveSong() {
			await editor.command.execute({
				command: new UpdateElementsCommand({
					updates: [
						{
							trackId,
							elementId: clipId,
							patch: { startTime: mediaTime({ ticks: 120000 }) },
						},
					],
				}),
			});
			await editor.save.flush();
		},
		async query() {
			return queryMusicGrid({
				engine: editor.transactions,
				sourceAvailability,
				request: { kind: "list", bindingId: binding.id, limit: 10000 },
			});
		},
		seekNearBeat() {
			editor.playback.seek({ time: mediaTime({ ticks: 61000 }) });
		},
		playhead() {
			return editor.playback.getCurrentTime();
		},
		async visualUnchanged() {
			const after = await editor.transactions.clips();
			return (
				JSON.stringify(after.filter((clip) => clip.id !== clipId)) ===
				JSON.stringify(originalVisual.filter((clip) => clip.id !== clipId))
			);
		},
	};
}

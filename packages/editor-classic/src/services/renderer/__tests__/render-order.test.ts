/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- Small typed fixtures exercise the real graph builder without decoding media or rasterizing fonts. */
import { expect, test } from "bun:test";
import {
	composeFrameDescription,
	digestFrameDescription,
} from "../../../frame-proof";
import {
	decodeProject,
	encodeProject,
} from "../../../editor/persistence/project-codec";
import type { TProject } from "../../../project/types";
import type { MediaAsset } from "../../../media/types";
import type { TimelineTrack } from "../../../timeline/types";
import { buildScene } from "../scene-builder";

const SECOND = 120_000;
const text = (id: string) => ({
	id,
	name: id,
	type: "text",
	startTime: 0,
	duration: 70 * SECOND,
	trimStart: 0,
	trimEnd: 0,
	params: { content: id },
});
const track = ({
	id,
	elements,
	hidden = false,
}: {
	id: string;
	elements: unknown[];
	hidden?: boolean;
}) => ({
	id,
	name: id,
	type: "text",
	elements,
	hidden,
});
function fixture(): TProject {
	return {
		metadata: {
			id: "layer-proof",
			name: "Layers",
			duration: 70 * SECOND,
			createdAt: new Date(0),
			updatedAt: new Date(0),
		},
		version: 32,
		currentSceneId: "scene",
		motionTextSequences: [],
		settings: {
			fps: { numerator: 30, denominator: 1 },
			canvasSize: { width: 1920, height: 1080 },
			background: { type: "color", color: "transparent" },
		},
		scenes: [
			{
				id: "scene",
				name: "Scene",
				isMain: true,
				bookmarks: [],
				createdAt: new Date(0),
				updatedAt: new Date(0),
				tracks: {
					overlay: [
						track({ id: "fg", elements: [text("foreground")] }),
						track({ id: "lyrics", elements: [text("lyric")] }),
						track({ id: "hidden", elements: [text("hidden")], hidden: true }),
					],
					main: {
						id: "main",
						name: "Video",
						type: "video",
						muted: false,
						hidden: false,
						elements: [
							{
								id: "background",
								name: "Video",
								type: "video",
								mediaId: "video",
								startTime: 0,
								duration: 70 * SECOND,
								trimStart: 0,
								trimEnd: 0,
								params: {},
							},
						],
					},
					audio: [
						{
							id: "song",
							name: "Song",
							type: "audio",
							muted: false,
							elements: [
								{
									...text("song"),
									type: "audio",
									sourceType: "upload",
									mediaId: "song",
								},
							],
						},
					],
				},
			},
		],
	} as unknown as TProject;
}
const media = [
	{
		id: "video",
		name: "Video",
		type: "video",
		duration: 70,
		file: new File([new Uint8Array([0])], "fixture.mp4"),
		url: "blob:fixture",
	},
] as MediaAsset[];

function graphOrder(project: TProject) {
	return buildScene({
		canvasSize: project.settings.canvasSize,
		tracks: project.scenes[0]!.tracks,
		mediaAssets: media,
		duration: project.metadata.duration,
		background: project.settings.background,
		assetResolver: {} as never,
	}).children.flatMap((node) => {
		const params = node.params as Record<string, unknown>;
		const id = params.clipId ?? params.id;
		return typeof id === "string" ? [id] : [];
	});
}

test("real graph and schema 2 proof put video below native text below foreground, including reopen", async () => {
	const project = fixture();
	const reopened = decodeProject(
		JSON.parse(JSON.stringify(encodeProject({ project }))),
	);
	for (const candidate of [project, reopened]) {
		const proof = composeFrameDescription({
			project: candidate,
			assets: [],
			at: 61 * SECOND,
		});
		expect(proof.schemaVersion).toBe(2);
		expect(graphOrder(candidate)).toEqual([
			"background",
			"lyric",
			"foreground",
		]);
		expect(proof.elements.map((element) => element.id)).toEqual(
			graphOrder(candidate),
		);
		expect(proof.elements.map((element) => element.z)).toEqual([0, 1, 2]);
		expect(proof.audio.map((element) => element.id)).toEqual(["song"]);
		expect("z" in proof.audio[0]!).toBe(false);
	}
	expect(
		await digestFrameDescription(
			composeFrameDescription({ project, assets: [], at: 61 * SECOND }),
		),
	).toBe(
		await digestFrameDescription(
			composeFrameDescription({
				project: reopened,
				assets: [],
				at: 61 * SECOND,
			}),
		),
	);
});

test("proof exposes the actual occluding order instead of claiming buried lyrics are above video", () => {
	const project = fixture();
	const tracks = project.scenes[0]!.tracks;
	tracks.overlay.splice(1, 0, { ...tracks.main, id: "shots" });
	tracks.main.elements = [];
	const proof = composeFrameDescription({
		project,
		assets: [],
		at: 61 * SECOND,
	});
	expect(graphOrder(project)).toEqual(["lyric", "background", "foreground"]);
	expect(proof.elements.map((element) => element.id)).toEqual(
		graphOrder(project),
	);
});

test("equal-time element order is locale independent and hidden elements are excluded in both paths", () => {
	const project = fixture();
	project.scenes[0]!.tracks.overlay = [
		track({
			id: "lyrics",
			elements: [text("ä"), text("z"), { ...text("hidden"), hidden: true }],
		}) as TimelineTrack,
	] as never;
	const proof = composeFrameDescription({
		project,
		assets: [],
		at: 61 * SECOND,
	});
	expect(graphOrder(project)).toEqual(["background", "z", "ä"]);
	expect(proof.elements.map((element) => element.id)).toEqual(
		graphOrder(project),
	);
	expect(
		composeFrameDescription({ project, assets: [], at: 70 * SECOND }).elements,
	).toEqual([]);
});

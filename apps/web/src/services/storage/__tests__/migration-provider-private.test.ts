import { describe, expect, test } from "bun:test";
import { transformProjectV1ToV2 } from "../migrations/transformers/v1-to-v2";
import { isRecord } from "../migrations/transformers/utils";

describe("v1 migration provider-private preservation", () => {
	test("retains unknown fields at project, metadata, scene, track and clip levels", () => {
		const projectId = "private-project";
		const sceneId = "private-scene";
		const result = transformProjectV1ToV2({
			project: {
				id: projectId,
				version: 1,
				metadata: {
					id: projectId,
					name: "private project",
					providerPrivateMetadata: { keep: "metadata" },
				},
				scenes: [
					{
						id: sceneId,
						isMain: true,
						tracks: [],
						providerPrivateScene: { keep: "scene" },
					},
				],
				providerPrivateProject: { keep: "project" },
			},
			context: {
				legacyTracksBySceneId: {
					[sceneId]: [
						{
							id: "private-track",
							name: "private track",
							type: "media",
							providerPrivateTrack: { keep: "track" },
							elements: [
								{
									id: "private-clip",
									name: "private clip",
									type: "media",
									mediaId: "private-media",
									providerPrivateClip: { keep: "clip" },
								},
							],
						},
					],
				},
				mediaTypesById: { "private-media": "image" },
			},
		});

		expect(result.skipped).toBe(false);
		expect(result.project.providerPrivateProject).toEqual({ keep: "project" });
		expect(result.project.metadata).toMatchObject({
			providerPrivateMetadata: { keep: "metadata" },
		});
		const scenes = result.project.scenes;
		const scene = Array.isArray(scenes) && isRecord(scenes[0]) ? scenes[0] : {};
		expect(scene.providerPrivateScene).toEqual({ keep: "scene" });
		const track =
			Array.isArray(scene.tracks) && isRecord(scene.tracks[0])
				? scene.tracks[0]
				: {};
		expect(track.providerPrivateTrack).toEqual({ keep: "track" });
		const clip =
			Array.isArray(track.elements) && isRecord(track.elements[0])
				? track.elements[0]
				: {};
		expect(clip.providerPrivateClip).toEqual({ keep: "clip" });
	});
});

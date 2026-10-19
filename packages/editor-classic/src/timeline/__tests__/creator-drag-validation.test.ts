import { describe, expect, test } from "bun:test";
import { validateCreatorDrag } from "../creator-drag-validation";
import type { CreatorWorkspaceSnapshot } from "../../editor/surface/creator-workspace-types";
import type { MediaDragData } from "../drag";

const dragData: MediaDragData = {
	type: "media",
	id: "version-a",
	name: "素材",
	mediaType: "image",
	creator: {
		projectId: "creator-project",
		nativeProjectId: "native-project",
		sceneId: "scene",
		assetId: "asset",
		versionId: "version-a",
		sha256: "hash-a",
	},
};
const snapshot: CreatorWorkspaceSnapshot = {
	projectId: "creator-project",
	revision: "1",
	documents: [],
	capabilities: {
		saveDocument: false,
		selectVersion: true,
		regenerate: false,
		placeVersion: true,
		mention: false,
	},
	assets: [
		{
			id: "asset",
			name: "素材",
			selectedVersionId: "version-b",
			versions: [
				{
					id: "version-a",
					label: "A",
					mediaType: "image",
					sha256: "hash-a",
					status: "ready",
				},
				{
					id: "version-b",
					label: "B",
					mediaType: "image",
					sha256: "hash-b",
					status: "ready",
				},
			],
		},
	],
};
const validate = (next = snapshot) =>
	validateCreatorDrag({
		dragData,
		snapshot: next,
		projectId: "native-project",
		sceneId: "scene",
	});

describe("fixed creator drag source", () => {
	test("keeps the dragged version when selectedVersion changes", () => {
		expect(validate()).toBe(true);
	});
	test("rejects changed hash or removed version", () => {
		expect(
			validate({
				...snapshot,
				assets: [
					{
						...snapshot.assets[0],
						versions: [
							{ ...snapshot.assets[0].versions[0], sha256: "changed" },
						],
					},
				],
			}),
		).toBe(false);
		expect(validate({ ...snapshot, assets: [] })).toBe(false);
	});
	test("rejects cross-project and cross-scene drops", () => {
		expect(validate({ ...snapshot, projectId: "other" })).toBe(false);
		expect(
			validateCreatorDrag({
				dragData,
				snapshot,
				projectId: "other",
				sceneId: "scene",
			}),
		).toBe(false);
		expect(
			validateCreatorDrag({
				dragData,
				snapshot,
				projectId: "native-project",
				sceneId: "other",
			}),
		).toBe(false);
	});
	test("rejects unavailable versions", () => {
		expect(
			validate({
				...snapshot,
				assets: [
					{
						...snapshot.assets[0],
						versions: [{ ...snapshot.assets[0].versions[0], status: "failed" }],
					},
				],
			}),
		).toBe(false);
	});
});

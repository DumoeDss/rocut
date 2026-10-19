import { expect, test } from "bun:test";
import { projectId, revisionOf } from "@opencut/editor-contracts";
import {
	isMediaFolderEditingAvailable,
	planMediaFolderMutation,
	validateMediaFolders,
} from "../media-folder-policy";
import type { TransactionEngineDocument } from "@opencut/editor-contracts/engine";

test("an older native runtime keeps legacy projects usable and refuses folder writes", () => {
	if (isMediaFolderEditingAvailable()) return;
	const document: TransactionEngineDocument = {
		project: {
			id: projectId("legacy"),
			name: "Legacy",
			canvasWidth: 640,
			canvasHeight: 360,
			frameRate: { numerator: 30, denominator: 1 },
		},
		assets: [],
		tracks: [],
		clips: [],
		markers: [],
		revision: revisionOf(0),
		idempotency: [],
	};
	expect(validateMediaFolders({ document })).toEqual([]);
	expect(() =>
		planMediaFolderMutation({
			document,
			operation: { kind: "create", id: "f", name: "Folder" },
		}),
	).toThrow("unavailable");
	expect(
		validateMediaFolders({
			document: {
				...document,
				project: {
					...document.project!,
					mediaFolders: {
						projectId: "legacy",
						folders: [],
						assignments: [],
					},
				},
			},
		}),
	).toMatchObject([{ code: "provider:media-folders" }]);
});

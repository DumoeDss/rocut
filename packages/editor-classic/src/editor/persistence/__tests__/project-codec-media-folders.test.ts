import { expect, test } from "bun:test";
import { decodeProject, encodeProject } from "../project-codec";
import { projectFixture } from "../../transactions/opencut/__tests__/fixture";

test("media folders survive save/reopen and complete replacement removes old members", () => {
	const project = projectFixture();
	project.mediaFolders = {
		projectId: project.metadata.id,
		folders: [{ id: "folder", name: "Retained" }],
		assignments: [{ assetId: "asset", folderId: "folder" }],
	};
	const retained = encodeProject({ project, retained: {} });
	expect(decodeProject(retained).mediaFolders).toEqual(project.mediaFolders);
	project.mediaFolders = {
		...project.mediaFolders,
		folders: [],
		assignments: [],
	};
	const reopened = decodeProject(encodeProject({ project, retained }));
	expect(reopened.mediaFolders?.folders).toEqual([]);
	expect(reopened.mediaFolders?.assignments).toEqual([]);
	expect(decodeProject(retained).mediaFolders?.folders).toHaveLength(1);
});

test("legacy projects without folder state reopen without a migration", () => {
	const project = projectFixture();
	expect(
		decodeProject(encodeProject({ project, retained: {} })).mediaFolders,
	).toBeUndefined();
});

import { decodeProject } from "../../editor/persistence/project-codec";

export interface IsolatedExportSource {
	readonly projectId: string;
	readonly revision: number;
	readonly data: unknown;
}

/** Decode a detached render view, never installing it in the editor session. */
export function decodeIsolatedExportSource(source: IsolatedExportSource) {
	if (
		!/^composition:[a-f0-9]{64}$/.test(source.projectId) ||
		source.revision !== 0
	)
		throw new Error("composition-export-source-identity-invalid");
	const project = decodeProject(source.data);
	if (
		project.metadata.id !== source.projectId ||
		project.scenes.length !== 1 ||
		project.currentSceneId !== "composition-scene" ||
		project.scenes[0].id !== project.currentSceneId
	)
		throw new Error("composition-export-source-view-invalid");
	return project;
}

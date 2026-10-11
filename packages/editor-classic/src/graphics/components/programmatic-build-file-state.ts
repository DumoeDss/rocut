import { isAuthorTextFile } from "./programmatic-build-text";
import {
	isBuildDraftDirty,
	type BuildDraftSnapshot,
} from "./programmatic-build-draft-state";

export type AuthorFileOperation =
	| { op: "add"; id: string }
	| { op: "delete" }
	| { op: "rename"; id: string };

function assertNewPath(state: BuildDraftSnapshot, id: string) {
	if (
		!isAuthorTextFile(id) ||
		!id ||
		id.length > 240 ||
		!/^[A-Za-z0-9/._-]+$/.test(id) ||
		id
			.split("/")
			.some(
				(part) =>
					!part ||
					part === "." ||
					part === ".." ||
					/[\\:< >"|?*\u0000-\u001f]/.test(part) ||
					/[. ]$/.test(part) ||
					/^(?:node_modules|_rocut|\.git)$/i.test(part) ||
					/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
			)
	)
		throw Error(
			"Use a portable relative text source path, such as src/scene.tsx.",
		);
	const lower = id.toLowerCase();
	if (
		[
			...state.fileIds,
			...(state.baseline.build?.inputs.map((item) => item.id) ?? []),
		].some(
			(path) =>
				path.toLowerCase() === lower ||
				path.toLowerCase().startsWith(`${lower}/`) ||
				lower.startsWith(`${path.toLowerCase()}/`),
		)
	)
		throw Error(
			"The file path is already used by an archived file or directory.",
		);
}

export function changeBuildFiles(
	state: BuildDraftSnapshot,
	operation: AuthorFileOperation,
): BuildDraftSnapshot {
	if (state.phase === "compiling" || state.phase === "saving" || state.conflict)
		return state;
	const files = { ...state.files };
	let fileIds = [...state.fileIds];
	let selectedId = state.selectedId;
	let entryFile = state.entryFile;
	if (operation.op === "add") {
		assertNewPath(state, operation.id);
		selectedId = operation.id;
		fileIds.push(selectedId);
		files[selectedId] = { original: "", code: "" };
	} else {
		if (!fileIds.includes(selectedId) || !isAuthorTextFile(selectedId))
			throw Error("Select a text source file.");
		if (operation.op === "delete") {
			if (selectedId === entryFile)
				throw Error("Rename the entry file before deleting it.");
			fileIds = fileIds.filter((id) => id !== selectedId);
			delete files[selectedId];
			selectedId = entryFile;
		} else {
			assertNewPath(state, operation.id);
			const file = files[selectedId];
			if (!file) throw Error("Load the source file before renaming it.");
			fileIds = fileIds.map((id) => (id === selectedId ? operation.id : id));
			files[operation.id] = file;
			delete files[selectedId];
			if (entryFile === selectedId) entryFile = operation.id;
			selectedId = operation.id;
		}
	}
	const next = {
		...state,
		files,
		fileIds,
		selectedId,
		entryFile,
		phase: null,
		error: null,
	};
	return { ...next, dirty: isBuildDraftDirty(next) };
}

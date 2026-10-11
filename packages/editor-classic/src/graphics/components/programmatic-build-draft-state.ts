import type { ProgrammaticSource } from "@opencut/editor-contracts";

interface TextDraft {
	readonly original: string;
	readonly code: string;
}
export interface BuildDraftSnapshot {
	readonly baseline: ProgrammaticSource;
	readonly selectedId: string;
	readonly fileIds: readonly string[];
	readonly entryFile: string;
	readonly files: Readonly<Record<string, TextDraft>>;
	readonly inputProps: string;
	readonly dirty: boolean;
	readonly conflict: boolean;
	readonly phase: "loading" | "compiling" | "saving" | null;
	readonly error: string | null;
}

export const authorPropsText = (source: ProgrammaticSource) =>
	JSON.stringify(source.build?.inputProps ?? {}, null, 2);

export function cleanBuildDraft({
	source,
	selectedId,
}: {
	source: ProgrammaticSource;
	selectedId?: string;
}): BuildDraftSnapshot {
	return {
		baseline: source,
		selectedId:
			typeof selectedId === "string" &&
			source.build?.inputs.some((item) => item.id === selectedId)
				? selectedId
				: (source.build?.entryFile ?? ""),
		files: {},
		fileIds: source.build?.inputs.map((item) => item.id) ?? [],
		entryFile: source.build?.entryFile ?? "",
		inputProps: authorPropsText(source),
		dirty: false,
		conflict: false,
		phase: null,
		error: null,
	};
}

export function editBuildDraft({
	state,
	patch,
}: {
	state: BuildDraftSnapshot;
	patch: { code?: string; inputProps?: string };
}): BuildDraftSnapshot {
	if (state.phase === "compiling" || state.phase === "saving") return state;
	const { selectedId, files } = state;
	const selected = files[selectedId];
	const nextFiles =
		selected && patch.code !== undefined
			? { ...files, [selectedId]: { ...selected, code: patch.code } }
			: files;
	const inputProps = patch.inputProps ?? state.inputProps;
	return {
		...state,
		files: nextFiles,
		inputProps,
		error: null,
		dirty: isBuildDraftDirty({ ...state, files: nextFiles, inputProps }),
	};
}

export function isBuildDraftDirty(state: BuildDraftSnapshot): boolean {
	const originalIds = state.baseline.build?.inputs.map((item) => item.id) ?? [];
	return (
		state.entryFile !== state.baseline.build?.entryFile ||
		state.fileIds.length !== originalIds.length ||
		state.fileIds.some((id) => !originalIds.includes(id)) ||
		Object.values(state.files).some((file) => file.code !== file.original) ||
		state.inputProps !== authorPropsText(state.baseline)
	);
}

export function failedBuildDraft({
	state,
	error,
}: {
	state: BuildDraftSnapshot;
	error: unknown;
}): BuildDraftSnapshot {
	return {
		...state,
		phase: null,
		error: error instanceof Error ? error.message : "Author operation failed.",
	};
}

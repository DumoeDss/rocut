import {
	isProgrammaticSource,
	type ProgrammaticSource,
} from "@opencut/editor-contracts";
import type { ProgrammaticFrameProvider } from "@opencut/editor-ports/host";
import {
	authorPropsText,
	type BuildDraftSnapshot,
} from "./programmatic-build-draft-state";
import { parseAuthorProps } from "./programmatic-build-text";

/** Prepare a replacement only; state freshness and durable commit stay in the draft. */
export async function compileBuildDraft({
	submitted,
	provider,
	signal,
}: {
	submitted: BuildDraftSnapshot;
	provider?: ProgrammaticFrameProvider;
	signal: AbortSignal;
}): Promise<ProgrammaticSource> {
	if (!provider?.reviseBuild)
		throw Error("This host cannot recompile archived author files.");
	const originalIds =
		submitted.baseline.build?.inputs.map((item) => item.id) ?? [];
	const changes: (
		| { id: string; code: string; op?: "add" }
		| { id: string; op: "delete" }
	)[] = originalIds
		.filter((id) => !submitted.fileIds.includes(id))
		.map((id) => ({ id, op: "delete" }));
	for (const [id, file] of Object.entries(submitted.files)) {
		if (!originalIds.includes(id))
			changes.push({ id, op: "add", code: file.code });
		else if (file.code !== file.original) changes.push({ id, code: file.code });
	}
	const result = await provider.reviseBuild({
		signal,
		request: {
			source: submitted.baseline,
			changes,
			...(submitted.entryFile !== submitted.baseline.build?.entryFile
				? { entryFile: submitted.entryFile }
				: {}),
			...(submitted.inputProps !== authorPropsText(submitted.baseline)
				? { inputProps: parseAuthorProps(submitted.inputProps) }
				: {}),
		},
	});
	signal.throwIfAborted();
	if (
		!result ||
		typeof result !== "object" ||
		!("source" in result) ||
		!isProgrammaticSource(result.source) ||
		!result.source.build ||
		result.source.build.engine !== submitted.baseline.build?.engine
	)
		throw Error("Compiler returned an invalid archived source.");
	if (
		result.source.build.entryFile !== submitted.entryFile ||
		result.source.build.inputs.length !== submitted.fileIds.length ||
		result.source.build.inputs.some(
			(item) => !submitted.fileIds.includes(item.id),
		)
	)
		throw Error("Compiler returned a different author file set or entry file.");
	return result.source;
}

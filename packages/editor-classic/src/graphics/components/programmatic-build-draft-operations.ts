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
	const changes = Object.entries(submitted.files)
		.filter(([, file]) => file.code !== file.original)
		.map(([id, file]) => ({ id, code: file.code }));
	const result = await provider.reviseBuild({
		signal,
		request: {
			source: submitted.baseline,
			changes,
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
	return result.source;
}

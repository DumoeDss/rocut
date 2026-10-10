import {
	isProgrammaticSource,
	type ProgrammaticSource,
} from "../../packages/editor-contracts/src/programmatic";

function record(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

async function post({
	action,
	body,
}: {
	action: string;
	body: unknown;
}): Promise<unknown> {
	const response = await fetch(`/api/programmatic/build/${action}`, {
		method: "POST",
		body: JSON.stringify(body),
	});
	if (!response.ok) throw Error(await response.text());
	return response.json();
}

/** Exercise the real Host inspection path for positive visual/media fixtures.
 * Invalid explicit-geometry fixtures remain on legacy compile intentionally. */
export async function compilePinnedRemotionProbe({
	spec,
}: {
	spec: Record<string, unknown>;
}): Promise<ProgrammaticSource> {
	const receipt = await post({
		action: "inspect",
		body: {
			version: spec.version,
			sourceDirectory: spec.sourceDirectory,
			entryFile: spec.entryFile,
			files: spec.files,
			inputProps: spec.inputProps,
			seed: spec.seed,
			frameRates: { [String(spec.compositionId)]: spec.frameRate },
		},
	});
	if (
		!record(receipt) ||
		typeof receipt.revision !== "string" ||
		!record(receipt.metadataAdapter) ||
		receipt.metadataAdapter.id !== "rocut-remotion-html" ||
		receipt.metadataAdapter.version !== 2 ||
		!Array.isArray(receipt.compositions) ||
		!receipt.compositions.some(
			(value: unknown) => record(value) && value.id === spec.compositionId,
		)
	)
		throw Error("Missing v2 Remotion inspection receipt");
	const result = await post({
		action: "compile-inspected",
		body: {
			revision: receipt.revision,
			compositionId: spec.compositionId,
			frameRate: spec.frameRate,
		},
	});
	if (
		!record(result) ||
		result.inspectionRevision !== receipt.revision ||
		result.metadataStability !==
			"rechecked-before-compile; runtime-geometry-and-props-pinned-v1" ||
		!isProgrammaticSource(result.source) ||
		result.source.runtime !== "html-document" ||
		result.source.build?.engine !== "remotion"
	)
		throw Error("Remotion probe did not produce a pinned inspected source");
	return result.source;
}

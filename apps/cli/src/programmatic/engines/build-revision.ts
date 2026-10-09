import type {
	ProgrammaticSource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
import { resourceDigest } from "../resources";
import { describeResource } from "../resource-bytes";
import {
	sourceDescription,
	validateBuildSource,
	withBuildResources,
} from "./build-source";

interface BuildRevisionInput {
	readonly source: ProgrammaticSource;
	readonly changes: readonly { readonly id: string; readonly code: string }[];
	readonly inputProps?: Record<string, unknown>;
}

/** Mirrors the compiler's existing text decoding boundary, not a budget policy. */
export const isBuildTextInput = (id: string): boolean =>
	/\.(?:html?|css|[cm]?js|tsx?|jsx|json|svg)$/i.test(id);

export function parseBuildRevisionInput(input: unknown): BuildRevisionInput {
	if (!input || typeof input !== "object" || Array.isArray(input))
		throw Error("Expected build revision specification");
	const spec = input as Record<string, unknown>;
	if (
		Object.keys(spec).some(
			(key) => !["source", "changes", "inputProps"].includes(key),
		) ||
		!Array.isArray(spec.changes)
	)
		throw Error(
			"Build revision requires only source, changes and optional inputProps",
		);
	validateBuildSource(spec.source);
	const source = spec.source;
	if (!source.build) throw Error("Build revision requires an archived source");
	if (
		source.build.engine !== "hyperframes" &&
		source.build.engine !== "remotion"
	)
		throw Error(
			"Build revision currently supports only HyperFrames and Remotion archives",
		);
	const known = new Set(source.build.inputs.map((resource) => resource.id));
	const seen = new Set<string>();
	const changes = spec.changes.map((value: unknown) => {
		if (!value || typeof value !== "object" || Array.isArray(value))
			throw Error("Invalid build revision change");
		const change = value as Record<string, unknown>;
		if (
			Object.keys(change).some((key) => key !== "id" && key !== "code") ||
			typeof change.id !== "string" ||
			typeof change.code !== "string"
		)
			throw Error("Build revision changes require only id and code");
		if (!known.has(change.id))
			throw Error(`Build revision input is not archived: ${change.id}`);
		if (seen.has(change.id))
			throw Error(`Duplicate build revision input: ${change.id}`);
		if (!isBuildTextInput(change.id))
			throw Error(
				`Build revision input is not an editable text file: ${change.id}`,
			);
		seen.add(change.id);
		return { id: change.id, code: change.code };
	});
	if (Object.hasOwn(spec, "inputProps")) {
		if (
			!spec.inputProps ||
			typeof spec.inputProps !== "object" ||
			Array.isArray(spec.inputProps)
		)
			throw Error("Build revision inputProps must be an object");
		const inputProps = spec.inputProps as Record<string, unknown>;
		validateBuildSource({ ...source, build: { ...source.build, inputProps } });
		return { source, changes, inputProps };
	}
	return { source, changes };
}

/** Called only after every original input and the current toolchain lock verified. */
export function reviseBuildArchive({
	revision,
	inputs,
}: {
	revision: BuildRevisionInput;
	inputs: readonly ResolvedProgrammaticResource[];
}): { source: ProgrammaticSource; inputs: ResolvedProgrammaticResource[] } {
	const { source } = revision;
	if (!source.build) throw Error("Build revision requires an archived source");
	// A replacement must never hide an invalid baseline archived text file.
	for (const item of inputs)
		if (isBuildTextInput(item.resource.id))
			new TextDecoder("utf-8", { fatal: true }).decode(item.body);
	const changed = new Map(
		revision.changes.map((change) => [change.id, change.code]),
	);
	const updated = inputs.map((item) => {
		const code = changed.get(item.resource.id);
		if (code === undefined) return item;
		const bytes = new TextEncoder().encode(code);
		// TextEncoder replaces lone UTF-16 surrogates; source edits must be lossless.
		if (
			new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
				bytes,
			) !== code
		)
			throw Error(
				`Build revision code is not lossless UTF-8: ${item.resource.id}`,
			);
		return {
			resource: describeResource(
				sourceDescription(item.resource.id),
				bytes.byteLength,
				resourceDigest(bytes.buffer),
			),
			body: bytes.buffer,
		};
	});
	const revised = withBuildResources(
		{
			...source,
			build: {
				...source.build,
				...(revision.inputProps === undefined
					? {}
					: { inputProps: revision.inputProps }),
			},
		},
		updated.map((item) => item.resource),
		source.build.toolchainLock,
	);
	return { source: revised, inputs: updated };
}

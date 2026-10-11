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
	readonly changes: readonly BuildRevisionChange[];
	readonly entryFile?: string;
	readonly inputProps?: Record<string, unknown>;
}

type BuildRevisionChange =
	| {
			readonly id: string;
			readonly code: string;
			readonly op?: "replace" | "add";
	  }
	| { readonly id: string; readonly op: "delete" }
	| { readonly id: string; readonly op: "rename"; readonly to: string };

/** Mirrors the compiler's existing text decoding boundary, not a budget policy. */
export const isBuildTextInput = (id: string): boolean =>
	/\.(?:html?|css|[cm]?js|tsx?|jsx|json|svg|txt|csv|srt|vtt|lrc)$/i.test(id);

export function parseBuildRevisionInput(input: unknown): BuildRevisionInput {
	if (!input || typeof input !== "object" || Array.isArray(input))
		throw Error("Expected build revision specification");
	const spec = input as Record<string, unknown>;
	if (
		Object.keys(spec).some(
			(key) => !["source", "changes", "inputProps", "entryFile"].includes(key),
		) ||
		!Array.isArray(spec.changes)
	)
		throw Error(
			"Build revision requires source, changes and optional inputProps/entryFile",
		);
	validateBuildSource(spec.source);
	const source = spec.source;
	if (!source.build) throw Error("Build revision requires an archived source");
	if (
		source.build.engine !== "hyperframes" &&
		source.build.engine !== "remotion" &&
		source.build.engine !== "three"
	)
		throw Error(
			"Build revision currently supports only HyperFrames, Remotion and Three archives",
		);
	const known = new Set(source.build.inputs.map((resource) => resource.id));
	const seen = new Set<string>();
	const changes: BuildRevisionChange[] = spec.changes.map((value: unknown) => {
		if (!value || typeof value !== "object" || Array.isArray(value))
			throw Error("Invalid build revision change");
		const change = value as Record<string, unknown>;
		const op = Object.hasOwn(change, "op") ? change.op : "replace";
		const fields =
			op === "rename"
				? ["id", "op", "to"]
				: op === "delete"
					? ["id", "op"]
					: ["id", "op", "code"];
		if (
			typeof op !== "string" ||
			!["replace", "add", "delete", "rename"].includes(op) ||
			Object.keys(change).some((key) => !fields.includes(key)) ||
			typeof change.id !== "string"
		)
			throw Error("Invalid build revision operation");
		if (op === "add" ? known.has(change.id) : !known.has(change.id))
			throw Error(`Build revision input is not archived: ${change.id}`);
		if (seen.has(change.id))
			throw Error(`Duplicate build revision input: ${change.id}`);
		if (!isBuildTextInput(change.id))
			throw Error(
				`Build revision input is not an editable text file: ${change.id}`,
			);
		seen.add(change.id);
		if (op === "delete") return { id: change.id, op };
		if (op === "rename") {
			if (
				typeof change.to !== "string" ||
				!isBuildTextInput(change.to) ||
				known.has(change.to) ||
				seen.has(change.to)
			)
				throw Error("Rename requires an unused text source path");
			seen.add(change.to);
			return { id: change.id, op, to: change.to };
		}
		if (typeof change.code !== "string")
			throw Error("Text operation requires code");
		return {
			id: change.id,
			code: change.code,
			...(change.op ? { op: op as "add" | "replace" } : {}),
		};
	});
	if (spec.entryFile !== undefined && typeof spec.entryFile !== "string")
		throw Error("Build revision entryFile must be a string");
	const entryFile = spec.entryFile as string | undefined;
	const finalInputs = new Map(
		source.build.inputs.map((item) => [item.id, item]),
	);
	let finalEntry = entryFile ?? source.build.entryFile;
	for (const change of changes) {
		if (change.op === "delete") finalInputs.delete(change.id);
		else if (change.op === "rename") {
			const previous = finalInputs.get(change.id)!;
			finalInputs.delete(change.id);
			finalInputs.set(change.to, { ...previous, id: change.to });
			if (entryFile === undefined && finalEntry === change.id)
				finalEntry = change.to;
		} else if (change.op === "add")
			finalInputs.set(
				change.id,
				describeResource(sourceDescription(change.id), 1),
			);
	}
	validateBuildSource({
		...source,
		build: {
			...source.build,
			entryFile: finalEntry,
			inputs: [...finalInputs.values()],
			...(Object.hasOwn(spec, "inputProps")
				? { inputProps: spec.inputProps }
				: {}),
		},
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
		return {
			source,
			changes,
			inputProps,
			...(entryFile === undefined ? {} : { entryFile }),
		};
	}
	return { source, changes, ...(entryFile === undefined ? {} : { entryFile }) };
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
	const updatedInputs = new Map(inputs.map((item) => [item.resource.id, item]));
	let entryFile = revision.entryFile ?? source.build.entryFile;
	for (const change of revision.changes) {
		if (change.op === "delete") {
			updatedInputs.delete(change.id);
			continue;
		}
		if (change.op === "rename") {
			const item = updatedInputs.get(change.id);
			if (!item) throw Error(`Missing archived input: ${change.id}`);
			updatedInputs.delete(change.id);
			updatedInputs.set(change.to, {
				resource: { ...item.resource, id: change.to },
				body: item.body,
			});
			if (revision.entryFile === undefined && entryFile === change.id)
				entryFile = change.to;
			continue;
		}
		const { code } = change;
		const bytes = new TextEncoder().encode(code);
		// TextEncoder replaces lone UTF-16 surrogates; source edits must be lossless.
		if (
			new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
				bytes,
			) !== code
		)
			throw Error(`Build revision code is not lossless UTF-8: ${change.id}`);
		updatedInputs.set(change.id, {
			resource: describeResource(
				sourceDescription(change.id),
				bytes.byteLength,
				resourceDigest(bytes.buffer),
			),
			body: bytes.buffer,
		});
	}
	const updated = [...updatedInputs.values()].sort((a, b) =>
		a.resource.id < b.resource.id ? -1 : a.resource.id > b.resource.id ? 1 : 0,
	);
	const revised = withBuildResources(
		{
			...source,
			build: {
				...source.build,
				entryFile,
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

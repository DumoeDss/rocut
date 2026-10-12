import { isAbsolute } from "node:path";
import { IMAGE_SEQUENCE_RESOURCE_CAPABILITY } from "@opencut/editor-contracts";
import { importGltfModel } from "./model-import";
import {
	modelInputCapability,
	type ProgrammaticResourceValidationProbe,
} from "./model-input-capability";
import type { ProgrammaticResourceStore } from "./resources";
import {
	readResourceFile,
	saveResourceBytes,
	type ResourceDescription,
} from "./resource-bytes";

export const PROGRAMMATIC_RESOURCE_CAPABILITY = {
	version: 1,
	import: "programmatic/resources/import",
	load: "programmatic/resources/load",
	kinds: [
		"image",
		"font",
		"video",
		"model",
		"environment",
		"analysis",
		"document",
		"source",
		"imageSequence",
	],
	imageSequence: IMAGE_SEQUENCE_RESOURCE_CAPABILITY,
	audioImport: "programmatic/resources/import-audio",
	fontAxes: "static-opentype-v1",
	buildSourceArchive: {
		restore: "programmatic/resources/restore-build-source",
		input: ["source", "outputDirectory"],
		format: "rocut-build-source-restore-v1",
		output: [
			"source/",
			"resources/",
			"metadata/build-source.json",
			"metadata/toolchain-lock.json",
			"metadata/restore-receipt.json",
		],
		scope:
			"declared-build-inputs-and-source.resources-attachments; no-compile-import-or-project-mutation",
		outputDirectory:
			"must-not-exist; existing-nonredirected-parent; incomplete-output-retained",
	},
	modelArchive: {
		restore: "programmatic/resources/restore-model-source",
		format: "gltf-2.0-author-archive",
		input: ["sourceDirectory", "entryFile", "files"],
		output: "model/gltf-binary",
		externalImages: ["png", "jpeg", "webp", "ktx2"],
	},
	storage: "content-addressed-project-attachment",
	mutation: "import-prepares-resource; attach-via-editing-transaction",
} as const;

/** Add live Rust descriptor admission without mutating the legacy export or
 * asserting decoder, package, file contents, browser or GPU health. */
export function getProgrammaticResourceCapability(
	validate?: ProgrammaticResourceValidationProbe,
) {
	return {
		...PROGRAMMATIC_RESOURCE_CAPABILITY,
		modelInputs: modelInputCapability(validate),
	};
}

export async function importProgrammaticResource({
	input,
	...context
}: ProgrammaticResourceStore & { input: unknown }) {
	if (!input || typeof input !== "object" || Array.isArray(input))
		throw Error("Expected resource import object");
	const spec = input as Record<string, unknown>;
	if ("sourceDirectory" in spec || "entryFile" in spec || "files" in spec)
		return importGltfModel({ ...context, input });
	if (spec.kind === "imageSequence")
		throw Error(
			`Image sequences require ${IMAGE_SEQUENCE_RESOURCE_CAPABILITY.import} (programmatic sequence-import) with a complete dependency closure`,
		);
	if (
		Object.keys(spec).some(
			(key) => !["filePath", "id", "kind", "mimeType", "font"].includes(key),
		)
	)
		throw Error("Unknown resource import field");
	if (typeof spec.filePath !== "string" || !isAbsolute(spec.filePath))
		throw Error("Resource filePath must be absolute");
	const { filePath, ...description } = spec;
	// readResourceFile validates the transport fields with Rust before reading bytes.
	return saveResourceBytes(
		context,
		await readResourceFile(filePath, description as ResourceDescription),
	);
}

import { isAbsolute } from "node:path";
import { IMAGE_SEQUENCE_RESOURCE_CAPABILITY } from "@opencut/editor-contracts";
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
	storage: "content-addressed-project-attachment",
	mutation: "import-prepares-resource; attach-via-editing-transaction",
} as const;

export async function importProgrammaticResource({
	input,
	...context
}: ProgrammaticResourceStore & { input: unknown }) {
	if (!input || typeof input !== "object" || Array.isArray(input))
		throw Error("Expected resource import object");
	const spec = input as Record<string, unknown>;
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

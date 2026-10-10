import {
	isProgrammaticResource,
	type ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
import { sameImagePreprocessStructure } from "../../packages/editor-classic/src/services/renderer/programmatic/image-preprocess-identity";

export function loadInkExportResource({
	resources,
	resource,
}: {
	resources: readonly ResolvedProgrammaticResource[];
	resource: unknown;
}): Blob {
	if (!isProgrammaticResource(resource))
		throw Error("Invalid Ink attachment identity");
	const found = resources.find((item) =>
		sameImagePreprocessStructure({ left: item.resource, right: resource }),
	);
	if (!found) throw Error("Unknown Ink export attachment");
	return new Blob([found.body], { type: resource.mimeType });
}

import type { ResolvedProgrammaticResource } from "@opencut/editor-contracts";
import { TYPE_CARD_FONTS } from "./mv-type-card-source";
import { typeCardReferenceDigest } from "./mv-type-card-reference-realm";

export async function typeCardAssets() {
	const items = await Promise.all(
		TYPE_CARD_FONTS.map(async (definition) => {
			const response = await fetch(`/type-card-fonts/${definition.file}`);
			if (!response.ok)
				throw Error(`Missing explicit local typeCard font: ${definition.file}`);
			const body = await response.arrayBuffer(),
				sha256 = await typeCardReferenceDigest(body);
			const resource: ResolvedProgrammaticResource = {
				body,
				resource: {
					id: definition.id,
					kind: "font",
					mimeType: "font/ttf",
					byteLength: body.byteLength,
					sha256,
					attachmentKey: `programmatic-sha256-${sha256}`,
					font: {
						family: definition.family,
						weight: definition.weight,
						style: "normal",
					},
				},
			};
			return {
				resource,
				font: {
					family: definition.family,
					weight: definition.weight,
					bytes: body.slice(0),
				},
			};
		}),
	);
	return {
		resources: items.map((item) => item.resource),
		fonts: items.map((item) => item.font),
	};
}

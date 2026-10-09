import * as wasm from "opencut-wasm";
import {
	encodeImageSequenceImageRequest,
	type ImageSequenceManifest,
	type ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";

/** Rust admits the encoded container's real geometry before any physical decoder. */
export function validateImageSequenceFrame({
	loaded,
	manifest,
}: {
	loaded: ResolvedProgrammaticResource;
	manifest: Pick<ImageSequenceManifest, "width" | "height">;
}): void {
	if (loaded.resource.kind !== "image")
		throw Error("Expected an image sequence frame resource");
	if (typeof wasm.validateImageSequenceImageBytes !== "function")
		throw Error(
			"Image sequence frame admission requires the matching rebuilt Rocut WASM",
		);
	const result: unknown = JSON.parse(
		wasm.validateImageSequenceImageBytes(
			encodeImageSequenceImageRequest({
				mimeType: loaded.resource.mimeType,
				width: manifest.width,
				height: manifest.height,
				body: loaded.body,
			}),
		),
	);
	if (!result || typeof result !== "object")
		throw Error("Invalid image sequence image validator response");
	if ("error" in result && typeof result.error === "string")
		throw Error(result.error);
	if (
		!("width" in result) ||
		!("height" in result) ||
		!("decodedBytes" in result) ||
		result.width !== manifest.width ||
		result.height !== manifest.height ||
		typeof result.decodedBytes !== "number" ||
		!Number.isSafeInteger(result.decodedBytes)
	)
		throw Error("Invalid image sequence image validator response");
}

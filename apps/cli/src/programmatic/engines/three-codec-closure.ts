import { join } from "node:path";
import { readResourceFile } from "../resource-bytes";
import { resourceDigest } from "../resources";
import { LOCK_ID, sourceDescription } from "./build-source";

export const THREE_ASSET_CODEC_FILES = [
	"dist/draco.js",
	"dist/draco-decoder.js",
	"dist/glb.js",
	"dist/glb-validation.js",
	"dist/ktx2-glb.js",
	"dist/ktx2.js",
	"dist/ktx2-basis.js",
	"dist/ktx2-wasm.js",
	"dist/model.js",
	"DRACO-LICENSE.txt",
	"src/ktx2-basis-LICENSE.txt",
	"CODEC-PROVENANCE.md",
] as const;

/** New codecs are a fixed package closure; legacy archives keep their original lock. */
export async function loadThreeAssetCodecClosure({
	assetRoot,
	manifest,
	signal,
}: {
	assetRoot: string;
	manifest: Record<string, unknown>;
	signal: AbortSignal;
}) {
	if (manifest.elftiaAssetCodecs === undefined) return undefined;
	if (manifest.elftiaAssetCodecs !== "offline-codecs-v1")
		throw Error("Unknown fixed Three asset codec profile");
	const files = await Promise.all(
		THREE_ASSET_CODEC_FILES.map(async (path) => {
			const { body } = await readResourceFile(
				join(assetRoot, path),
				sourceDescription(LOCK_ID),
				signal,
			);
			return {
				path,
				byteLength: body.byteLength,
				sha256: resourceDigest(body),
				body,
			};
		}),
	);
	signal.throwIfAborted();
	const text = (path: (typeof THREE_ASSET_CODEC_FILES)[number]) =>
		new TextDecoder("utf-8", { fatal: true }).decode(
			files.find((file) => file.path === path)!.body,
		);
	return {
		identity: {
			version: 1,
			profile: "offline-codecs-v1",
			files: files.map(({ path, byteLength, sha256 }) => ({
				path,
				byteLength,
				sha256,
			})),
		},
		notices: [
			{
				name: "draco",
				version: "three-0.185.1",
				license: text("DRACO-LICENSE.txt"),
			},
			{
				name: "basis-universal",
				version: "three-0.185.1",
				license: text("src/ktx2-basis-LICENSE.txt"),
			},
			{
				name: "three-asset-codec-provenance",
				version: "1",
				license: text("CODEC-PROVENANCE.md"),
			},
		],
	};
}

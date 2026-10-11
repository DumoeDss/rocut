import { join } from "node:path";
import { readResourceFile } from "../resource-bytes";
import { resourceDigest } from "../resources";
import { LOCK_ID, sourceDescription } from "./build-source";
import { THREE_FRAME_DRIVER } from "./three-driver";

export const THREE_ASSET_FEATURE_PROFILE = "svg-animation-v1";
export const THREE_ASSET_FEATURE_FILES = [
	"dist/svg-model.js",
	"dist/model-animation.js",
	"dist/model-instance.js",
	"dist/ownership.js",
	"dist/types.js",
	"dist/index.js",
] as const;

/** Kept separate so legacy and native-profile driver bytes remain unchanged. */
export const THREE_MODEL_FEATURE_DRIVER = THREE_FRAME_DRIVER.replace(
	"import {loadModel,loadTexture,loadEnvironment} from '@elftia/three-assets';",
	"import {loadModel,loadTexture,loadEnvironment,loadSvgModel} from '@elftia/three-assets';",
).replace(
	"    async model(id){",
	String.raw`    async svg(id,settings){
      if(!settings || typeof settings!=='object' || Array.isArray(settings)
        || Object.keys(settings).some(key=>!['modeling','curveSegments'].includes(key)))
        throw Error('SVG settings require modeling and optional curveSegments');
      const asset=descriptor(id,'model');
      const model=await loadSvgModel(asset,{
        ...options,modeling:settings.modeling,curveSegments:settings.curveSegments,
        maxSegments:1024,maxVertices:100000,
      });
      own(model);
      signal.throwIfAborted(); return own(model.createInstance());
    },
    async model(id){`,
);

export function selectThreeAssetDriver({
	driver,
	modelFeatures,
	nativeProfile,
	resources,
}: {
	driver: string;
	modelFeatures: boolean;
	nativeProfile: boolean;
	resources: readonly { kind: string; mimeType: string }[];
}) {
	if (
		resources.some(
			(resource) =>
				resource.kind === "model" && resource.mimeType === "image/svg+xml",
		) &&
		(!modelFeatures || nativeProfile)
	)
		throw Error(
			"SVG models require the fixed svg-animation-v1 package and ordinary Three profile",
		);
	return modelFeatures && !nativeProfile ? THREE_MODEL_FEATURE_DRIVER : driver;
}

export async function loadThreeAssetFeatureClosure({
	assetRoot,
	manifest,
	signal,
}: {
	assetRoot: string;
	manifest: Record<string, unknown>;
	signal: AbortSignal;
}) {
	if (manifest.elftiaAssetFeatures === undefined) return undefined;
	if (manifest.elftiaAssetFeatures !== THREE_ASSET_FEATURE_PROFILE)
		throw Error("Unknown fixed Three asset feature profile");
	const files = await Promise.all(
		THREE_ASSET_FEATURE_FILES.map(async (path) => {
			const { body } = await readResourceFile(
				join(assetRoot, path),
				sourceDescription(LOCK_ID),
				signal,
			);
			return {
				path,
				byteLength: body.byteLength,
				sha256: resourceDigest(body),
			};
		}),
	);
	signal.throwIfAborted();
	return { version: 1, profile: THREE_ASSET_FEATURE_PROFILE, files };
}

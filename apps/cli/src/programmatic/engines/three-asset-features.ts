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

/** Native leases are asynchronous and every API operation participates in drain. */
export function nativeThreeSvgDriver(driver: string): string {
	const imported =
		"import {loadModel,loadTexture,loadEnvironment} from '@elftia/three-assets';";
	const method = "    async model(id){";
	if (driver.split(imported).length !== 2 || driver.split(method).length !== 2)
		throw Error("Native SVG assets require the known shared loader layout");
	const svg = THREE_MODEL_FEATURE_DRIVER.slice(
		THREE_MODEL_FEATURE_DRIVER.indexOf("    async svg(id,settings){"),
		THREE_MODEL_FEATURE_DRIVER.indexOf(method),
	).replace("      own(model);", "      await own(model);");
	return driver
		.replace(
			imported,
			imported.replace("loadEnvironment}", "loadEnvironment,loadSvgModel}"),
		)
		.replace(method, svg + method);
}

export function hasThreeSvgModel(
	resources: readonly { kind: string; mimeType: string }[] = [],
) {
	return resources.some(
		(resource) =>
			resource.kind === "model" && resource.mimeType === "image/svg+xml",
	);
}
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
	const svg = hasThreeSvgModel(resources);
	if (svg && !modelFeatures)
		throw Error("SVG models require the fixed svg-animation-v1 package");
	return nativeProfile
		? svg
			? nativeThreeSvgDriver(driver)
			: driver
		: modelFeatures
			? THREE_MODEL_FEATURE_DRIVER
			: driver;
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

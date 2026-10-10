import { threeEnvironment, threeModel, threePalette } from "./three-assets";
export function glassObjectAssets() {
	return [
		{
			id: "glass-model.glb",
			kind: "model",
			mimeType: "model/gltf-binary",
			body: threeModel(),
		},
		{
			id: "glass-environment.hdr",
			kind: "environment",
			mimeType: "image/vnd.radiance",
			body: threeEnvironment(false, 64, 32),
		},
		{
			id: "glass-background.png",
			kind: "image",
			mimeType: "image/png",
			body: threePalette(),
		},
	];
}

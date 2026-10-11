import { THREE_ASSET_FEATURE_PROFILE } from "./three-asset-features";
import { THREE_ASSET_CODEC_PROFILE } from "./three-codec-closure";
import { THREE_TOOLCHAIN } from "./engine-versions";

/** Requirements and supported subset only. This performs no package, decoder,
 * filesystem, browser or GPU health probe and must not assert configured:true. */
export function threeModelCapability() {
	return {
		requiredPackageProfile: THREE_ASSET_FEATURE_PROFILE,
		animation: "absolute-seconds-v1",
		svg: ["flat", "extrude"],
		availability: "requires-package-and-compile-admission",
		scope: "ordinary-three; not-native-particle-or-liquid",
		environment: {
			requiredPackage: {
				name: "@elftia/three-assets",
				version: THREE_TOOLCHAIN["@elftia/three-assets"],
			},
			availability: "requires-package-and-compile-admission",
			resourceKind: "environment",
			mimeTypes: ["image/vnd.radiance", "image/x-exr"],
			api: "assets.environment(id)",
			mapping: "equirectangular-reflection",
			minimumLightingImageSize: { width: 64, height: 32 },
			validation: "reject-malformed-and-over-budget-assets",
			scope: "environment-resource; no-decoder-or-gpu-health-probe",
		},
		codecs: {
			requiredPackageProfile: THREE_ASSET_CODEC_PROFILE,
			packageManifestFlag: "elftiaAssetCodecs",
			availability: "requires-package-and-compile-admission",
			io: "fixed-local-codec-closure; no-network-or-workers",
			draco: {
				extension: "KHR_draco_mesh_compression",
				container: "self-contained-glb",
				geometry: "indexed-triangle",
			},
			ktx2: {
				extension: "KHR_texture_basisu",
				container: "glb-embedded",
				dimensions: "2d",
				dynamicRange: "ldr",
				encodings: ["etc1s", "uastc"],
				mipmaps: true,
			},
			unsupported: [
				"external-codec-urls-and-workers",
				"standalone-drc-or-ktx2-entrypoints",
				"draco-point-cloud-non-indexed-or-non-triangle",
				"ktx2-hdr",
				"ktx2-zstd-or-zlib-supercompression",
				"ktx2-array-cube-or-3d",
				"ktx2-video",
				"ktx2-non-rd-orientation-or-non-rgba-swizzle",
				"ktx2-premultiplied-alpha-or-nonzero-dfd-flags",
				"ktx2-transfer-other-than-linear-or-srgb",
			],
			validation: "reject-malformed-and-over-budget-assets",
			legacyPackages: {
				compile: "preserve-package-profile",
				rebuild: "preserve-archived-toolchain-profile",
				implicitUpgrade: false,
			},
		},
	};
}

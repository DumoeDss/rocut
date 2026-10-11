import { expect, test } from "bun:test";
import { threeModelCapability } from "../programmatic/engines/three-model-capability";
import { THREE_ASSET_CODEC_PROFILE } from "../programmatic/engines/three-codec-closure";
import { THREE_ASSET_FEATURE_PROFILE } from "../programmatic/engines/three-asset-features";
import { THREE_TOOLCHAIN } from "../programmatic/engines/engine-versions";
import { createProgrammaticBuildService } from "../programmatic/engines/build-service";
import type { ProgrammaticResourceStore } from "../programmatic/resources";

test("Three models retain existing fields and expose compiler-owned codec profile requirements", () => {
	const { codecs, environment, ...legacy } = threeModelCapability();
	expect(legacy).toEqual({
		requiredPackageProfile: THREE_ASSET_FEATURE_PROFILE,
		animation: "absolute-seconds-v1",
		svg: ["flat", "extrude"],
		availability: "requires-package-and-compile-admission",
		scope: "ordinary-three; not-native-particle-or-liquid",
	});
	expect(codecs.requiredPackageProfile).toBe(THREE_ASSET_CODEC_PROFILE);
	expect(codecs.requiredPackageProfile).toBe("offline-codecs-v1");
	expect(codecs.packageManifestFlag).toBe("elftiaAssetCodecs");
	expect(codecs.availability).toBe("requires-package-and-compile-admission");
	expect(codecs).not.toHaveProperty("configured");
	expect(environment.availability).toBe(
		"requires-package-and-compile-admission",
	);
});

test("environment discovery advertises actual package requirements, not decoder or GPU readiness", () => {
	const environment = threeModelCapability().environment;
	expect(environment).toEqual({
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
	});
	expect(environment).not.toHaveProperty("configured");
	expect(environment).not.toHaveProperty("requiredPackageProfile");
});

test("codec metadata advertises only admitted GLB subsets and explicit rejections", () => {
	const codecs = threeModelCapability().codecs;
	expect(codecs.draco).toEqual({
		extension: "KHR_draco_mesh_compression",
		container: "self-contained-glb",
		geometry: "indexed-triangle",
	});
	expect(codecs.ktx2).toEqual({
		extension: "KHR_texture_basisu",
		container: "glb-embedded",
		dimensions: "2d",
		dynamicRange: "ldr",
		encodings: ["etc1s", "uastc"],
		mipmaps: true,
	});
	for (const subset of [
		"standalone-drc-or-ktx2-entrypoints",
		"draco-point-cloud-non-indexed-or-non-triangle",
		"ktx2-hdr",
		"ktx2-zstd-or-zlib-supercompression",
		"ktx2-array-cube-or-3d",
		"ktx2-video",
		"ktx2-non-rd-orientation-or-non-rgba-swizzle",
		"ktx2-premultiplied-alpha-or-nonzero-dfd-flags",
		"ktx2-transfer-other-than-linear-or-srgb",
	])
		expect(codecs.unsupported).toContain(subset);
	expect(codecs.io).toBe("fixed-local-codec-closure; no-network-or-workers");
	expect(codecs.validation).toBe("reject-malformed-and-over-budget-assets");
	expect(codecs.legacyPackages).toEqual({
		compile: "preserve-package-profile",
		rebuild: "preserve-archived-toolchain-profile",
		implicitUpgrade: false,
	});
});

test("build service exposes requirements without probing nonexistent package paths or claiming codec readiness", async () => {
	for (const toolchain of [
		"relative-toolchain",
		"C:/tmps/nonexistent-codec-capability-toolchain",
	]) {
		// Capability-only use must not touch the resource store or compiler IO.
		const context = new Proxy({} as ProgrammaticResourceStore, {
			get() {
				throw Error("Capability unexpectedly accessed resources");
			},
		});
		const service = createProgrammaticBuildService(
			context,
			async (task) => task(),
			toolchain,
			{},
		);
		try {
			expect(service.capability.threeModels).toEqual(threeModelCapability());
			expect(service.capability.threeModels.codecs).not.toHaveProperty(
				"configured",
			);
			expect(service.capability.downloads).toBe(false);
		} finally {
			await service.dispose();
		}
	}
});

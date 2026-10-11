import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";
import {
	loadThreeAssetFeatureClosure,
	selectThreeAssetDriver,
	THREE_ASSET_FEATURE_FILES,
	THREE_MODEL_FEATURE_DRIVER,
} from "../programmatic/engines/three-asset-features";
import { THREE_FRAME_DRIVER } from "../programmatic/engines/three-driver";
import { REMOTION_COMPILER_CHILD } from "../programmatic/engines/remotion-compiler-child";
import { threeToolchainProfile } from "../programmatic/engines/three-toolchain-profile";
import { resourceDigest } from "../programmatic/resources";
import { runtime } from "./three-liquid-object-provenance-fixture";

const signal = () => new AbortController().signal;
const manifest = { elftiaAssetFeatures: "svg-animation-v1" };

test("feature closure preserves legacy and rejects unknown flags and cancellation", async () => {
	const assetRoot = "C:/tmps/nonexistent-three-feature-root";
	expect(await loadThreeAssetFeatureClosure({ assetRoot, manifest: {}, signal: signal() })).toBeUndefined();
	for (const flag of [null, false, "unknown"])
		await expect(loadThreeAssetFeatureClosure({ assetRoot, manifest: { elftiaAssetFeatures: flag }, signal: signal() })).rejects.toThrow("Unknown fixed Three asset feature profile");
	const controller = new AbortController();
	controller.abort();
	await expect(loadThreeAssetFeatureClosure({ assetRoot, manifest, signal: controller.signal })).rejects.toThrow();
});

test("feature closure binds all six files, byte drift and missing files", async () => {
	const assetRoot = await mkdtemp("C:/tmps/three-asset-features-");
	try {
		for (const path of THREE_ASSET_FEATURE_FILES) {
			await mkdir(dirname(join(assetRoot, path)), { recursive: true });
			await writeFile(join(assetRoot, path), `fixture ${path}`, "utf8");
		}
		const before = await loadThreeAssetFeatureClosure({ assetRoot, manifest, signal: signal() });
		expect(before!.files.map(({ path }) => path)).toEqual([
			"dist/svg-model.js", "dist/model-animation.js", "dist/model-instance.js",
			"dist/ownership.js", "dist/types.js", "dist/index.js",
		]);
		expect(before!.profile).toBe("svg-animation-v1");
		for (const file of before!.files) expect(file.sha256).toMatch(/^[a-f0-9]{64}$/);
		await writeFile(join(assetRoot, "dist/model-animation.js"), "changed", "utf8");
		const after = await loadThreeAssetFeatureClosure({ assetRoot, manifest, signal: signal() });
		expect(after).not.toEqual(before);
		await rm(join(assetRoot, "dist/svg-model.js"));
		await expect(loadThreeAssetFeatureClosure({ assetRoot, manifest, signal: signal() })).rejects.toThrow();
	} finally { await rm(assetRoot, { recursive: true, force: true }); }
});

test("feature driver is ordinary-only and SVG models require its profile", () => {
	const svg = [{ kind: "model", mimeType: "image/svg+xml" }];
	for (const modelFeatures of [false, true]) for (const nativeProfile of [false, true]) {
		const options = { driver: THREE_FRAME_DRIVER, modelFeatures, nativeProfile, resources: [] };
		expect(selectThreeAssetDriver(options)).toBe(modelFeatures && !nativeProfile ? THREE_MODEL_FEATURE_DRIVER : THREE_FRAME_DRIVER);
		if (!modelFeatures || nativeProfile) expect(() => selectThreeAssetDriver({ ...options, resources: svg })).toThrow("SVG models require");
		else expect(selectThreeAssetDriver({ ...options, resources: svg })).toBe(THREE_MODEL_FEATURE_DRIVER);
	}
	const nativeDriver = "unchanged native driver bytes";
	expect(selectThreeAssetDriver({ driver: nativeDriver, modelFeatures: true, nativeProfile: true, resources: [] })).toBe(nativeDriver);
});

test("adapter identity binds the effective driver while native identity remains stable", () => {
	const digest = (driver: string) => resourceDigest(new TextEncoder().encode(driver + "\n" + REMOTION_COMPILER_CHILD).buffer);
	expect(threeToolchainProfile({}).adapter.sha256).toBe(digest(THREE_FRAME_DRIVER));
	expect(threeToolchainProfile({ modelFeatures: true }).adapter.sha256).toBe(digest(THREE_MODEL_FEATURE_DRIVER));
	expect(digest(THREE_MODEL_FEATURE_DRIVER)).not.toBe(digest(THREE_FRAME_DRIVER));
	const liquidRuntime = runtime();
	expect(threeToolchainProfile({ liquidRuntime, modelFeatures: true })).toEqual(threeToolchainProfile({ liquidRuntime }));
});

test("real enhanced asset API admits model SVG only and retains trusted options and both leases", async () => {
	const limits = { maxBytes: 1000 }, controller = new AbortController();
	const releases: string[] = [], calls: { asset: any; options: any }[] = [];
	let kind = "model";
	const bytes = new ArrayBuffer(3);
	const instance = { dispose: () => releases.push("instance") };
	const loaded = { dispose: () => releases.push("model"), createInstance: () => instance };
	// Execute the shipped resource API fragment with dependency bindings supplied
	// by the isolated realm; no browser renderer or GPU is needed.
	const fragment = THREE_MODEL_FEATURE_DRIVER.slice(0, THREE_MODEL_FEATURE_DRIVER.indexOf("const spec=window.__rocutThreeSpec;"))
		.replace(/^import .*;\r?\n/gm, "");
	const createAssets = runInNewContext(fragment + "\ncreateAssets", {
		window: { rocutResources: {
			descriptor: (id: string) => ({ id, kind, mimeType: "image/svg+xml", byteLength: 3, sha256: "a".repeat(64) }),
			bytes: () => bytes,
		} }, DOMException,
		loadSvgModel: async (asset: any, options: any) => { calls.push({ asset, options }); return loaded; },
		loadModel: () => { throw Error("unexpected model loader"); },
		loadTexture: () => { throw Error("unexpected texture loader"); },
		loadEnvironment: () => { throw Error("unexpected environment loader"); },
		sha256: () => new Uint8Array(32),
	});
	const assets = createAssets({ resourceLimits: limits }, controller.signal);
	const settings = { modeling: { mode: "flat" }, curveSegments: 8 };
	expect(await assets.api.svg("shape", settings)).toBe(instance);
	expect(calls[0]!.asset.mediaType).toBe("image/svg+xml");
	expect(calls[0]!.options.limits).toBe(limits);
	expect(calls[0]!.options.signal).toBe(controller.signal);
	expect(calls[0]!.options.modeling).toBe(settings.modeling);
	expect(calls[0]!.options.curveSegments).toBe(8);
	expect(calls[0]!.options.maxSegments).toBe(1024);
	expect(calls[0]!.options.maxVertices).toBe(100000);
	expect(await calls[0]!.options.resolver.read("shape", controller.signal)).toBe(bytes);
	for (const key of ["limits", "resolver", "signal", "maxSegments", "maxVertices", "digestSha256"])
		await expect(assets.api.svg("shape", { ...settings, [key]: {} })).rejects.toThrow("SVG settings");
	kind = "image";
	await expect(assets.api.svg("shape", settings)).rejects.toThrow("Unexpected resource kind");
	expect(calls).toHaveLength(1);
	assets.dispose(); assets.dispose();
	expect(releases).toEqual(["instance", "model"]);
});

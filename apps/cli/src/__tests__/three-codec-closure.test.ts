import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
	loadThreeAssetCodecClosure,
	THREE_ASSET_CODEC_FILES,
} from "../programmatic/engines/three-codec-closure";

const signal = () => new AbortController().signal;
const manifest = { elftiaAssetCodecs: "offline-codecs-v1" };

async function fixture() {
	const root = await mkdtemp("C:/tmps/three-codec-closure-");
	for (const path of THREE_ASSET_CODEC_FILES) {
		await mkdir(dirname(join(root, path)), { recursive: true });
		await writeFile(join(root, path), `fixture: ${path}\n`, "utf8");
	}
	return root;
}

test("legacy profiles keep their original lock and unknown profiles fail", async () => {
	const assetRoot = "C:/tmps/nonexistent-three-codec-profile";
	expect(await loadThreeAssetCodecClosure({ assetRoot, manifest: {}, signal: signal() })).toBeUndefined();
	await expect(loadThreeAssetCodecClosure({
		assetRoot, manifest: { elftiaAssetCodecs: "unknown" }, signal: signal(),
	})).rejects.toThrow("Unknown fixed Three asset codec profile");
});

test("new profile hashes the complete fixed closure and includes codec notices", async () => {
	const assetRoot = await fixture();
	try {
		const closure = await loadThreeAssetCodecClosure({ assetRoot, manifest, signal: signal() });
		expect(closure!.identity.profile).toBe("offline-codecs-v1");
		expect(closure!.identity.files.map(({ path }) => path)).toEqual([...THREE_ASSET_CODEC_FILES]);
		for (const file of closure!.identity.files) {
			expect(file.sha256).toMatch(/^[a-f0-9]{64}$/);
			expect(file.byteLength).toBeGreaterThan(0);
		}
		expect(closure!.notices.map(({ name }) => name)).toEqual([
			"draco", "basis-universal", "three-asset-codec-provenance",
		]);
		expect(closure!.notices[0]!.license).toContain("DRACO-LICENSE.txt");
		expect(closure!.notices[1]!.license).toContain("src/ktx2-basis-LICENSE.txt");
	} finally {
		await rm(assetRoot, { recursive: true, force: true });
	}
});

test("codec byte drift changes identity and any missing closure file fails", async () => {
	const assetRoot = await fixture();
	try {
		const before = await loadThreeAssetCodecClosure({ assetRoot, manifest, signal: signal() });
		await writeFile(join(assetRoot, "dist/ktx2-wasm.js"), "changed wasm bytes", "utf8");
		const after = await loadThreeAssetCodecClosure({ assetRoot, manifest, signal: signal() });
		expect(after!.identity).not.toEqual(before!.identity);
		const digest = (closure: NonNullable<typeof before>) => closure.identity.files.find(
			({ path }) => path === "dist/ktx2-wasm.js",
		)!.sha256;
		expect(digest(after!)).not.toBe(digest(before!));
		await rm(join(assetRoot, "DRACO-LICENSE.txt"));
		await expect(loadThreeAssetCodecClosure({ assetRoot, manifest, signal: signal() })).rejects.toThrow();
	} finally {
		await rm(assetRoot, { recursive: true, force: true });
	}
});

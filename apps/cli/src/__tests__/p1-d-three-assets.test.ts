import { expect, test } from "bun:test";
import { p1dModelAuthor, runP1dThreeAssets } from "./p1-d-three-assets-fixture";

test("P1-D local geometry preserves binary closure and a two-key linear animation", () => {
	const author = p1dModelAuthor(), document = JSON.parse(author.gltf.toString("utf8"));
	expect(document.buffers[0]).toEqual({ uri: "mesh.bin", byteLength: author.binary.length });
	expect(document.animations[0].name).toBe("P1DTranslation");
	expect(document.accessors[4].count).toBe(2);
	expect(document.accessors[5].type).toBe("VEC3");
});
const toolchain = process.env.ROCUT_TEST_P1D_THREE_TOOLCHAIN;
test.skipIf(!toolchain)("P1-D actual glTF archive/restore, Three compile, CPU animation and Host reopen", async () => {
	const receipt = await runP1dThreeAssets(toolchain!);
	expect(receipt.ok).toBe(true);
	expect(receipt.assetFeatureCompatibility.svgAcceptance).toBe(false);
	expect(receipt.negativeControls).toHaveLength(3);
}, 180000);

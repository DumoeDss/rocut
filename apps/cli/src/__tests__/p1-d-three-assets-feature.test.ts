import { expect, test } from "bun:test";
import { runP1dThreeAssetsFeature } from "./p1-d-three-assets-feature-fixture";

const toolchain = process.env.ROCUT_TEST_P1D_FEATURE_TOOLCHAIN;
test.skipIf(!toolchain)("P1-D offline feature glTF/SVG archive, actual animation API, Host compile and reopen", async () => {
	const receipt = await runP1dThreeAssetsFeature(toolchain!);
	expect(receipt.ok).toBe(true);
	expect(receipt.featureProfile.hostCompileAccepted).toBe(true);
	expect(receipt.svgRuntimeTested).toBe(false);
	expect(receipt.negativeControls).toHaveLength(2);
}, 180000);

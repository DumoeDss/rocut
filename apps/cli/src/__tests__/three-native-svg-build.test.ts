import { test, expect } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { runThreeNativeSvgBuild } from "../../../../script/fixtures/three-native-svg-build";

const toolchain = process.env.ROCUT_TEST_THREE_NATIVE_SVG_TOOLCHAIN,
	legacyToolchain = process.env.ROCUT_TEST_THREE_NATIVE_SVG_LEGACY_TOOLCHAIN;
test.skipIf(!toolchain || !legacyToolchain)(
	"Particle/Liquid SVG flat/extrude complete native build and archive-only rebuild",
	async () => {
		const root = await mkdtemp("C:/tmps/rocut-three-native-svg-test-");
		const receipt = await runThreeNativeSvgBuild({
			root,
			toolchain: toolchain!,
			legacyToolchain: legacyToolchain!,
		});
		expect(receipt.ok).toBe(true);
		expect(receipt.results).toHaveLength(6);
	},
	180000,
);

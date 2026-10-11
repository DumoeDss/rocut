import { test, expect } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { runParticleInputCompile } from "../../../../script/fixtures/particle-input-compile";

const toolchain = process.env.ROCUT_TEST_PARTICLE_INPUT_TOOLCHAIN;
test.skipIf(!toolchain)(
	"Particle image/explicit node-skin-morph animation full native compile and archive-only rebuild",
	async () => {
		const root = await mkdtemp("C:/tmps/rocut-particle-input-test-");
		const receipt = await runParticleInputCompile({
			root,
			toolchain: toolchain!,
		});
		expect(receipt.ok).toBe(true);
		expect(receipt.results).toHaveLength(2);
	},
	90000,
);

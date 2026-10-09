import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import {
	assertHyperframesFxRuntime,
	HYPERFRAMES_FX_NATIVE,
	loadHyperframesFxRuntime,
} from "../programmatic/hyperframes-fx-runtime";

test("FX loader refuses wrong native versions and unreviewed bytes before importing", async () => {
	const parent = resolve(tmpdir()),
		directory = await mkdtemp(join(parent, "rocut-fx-loader-test-"));
	const core = join(directory, "node_modules/@hyperframes/core");
	try {
		await mkdir(join(core, "dist/generated"), { recursive: true });
		await writeFile(
			join(core, "package.json"),
			JSON.stringify({ name: "@hyperframes/core", version: "0.8.140" }),
		);
		await writeFile(
			join(directory, "package-lock.json"),
			JSON.stringify({
				packages: {
					"node_modules/@hyperframes/core": {
						version: "0.8.139",
						integrity: "sha512-AAAA",
					},
				},
			}),
		);
		const options = {
			toolchainDirectory: directory,
			signal: new AbortController().signal,
		};
		await expect(loadHyperframesFxRuntime(options)).rejects.toThrow(
			"fixed core 0.8.139",
		);
		await writeFile(
			join(core, "package.json"),
			JSON.stringify({ name: "@hyperframes/core", version: "0.8.139" }),
		);
		const authored = "globalThis.__rocutUntrustedFxExecuted = true;";
		await writeFile(
			join(core, "dist/generated/audio-fx-runtime-inline.js"),
			authored.padEnd(HYPERFRAMES_FX_NATIVE.moduleBytes, " "),
		);
		await expect(loadHyperframesFxRuntime(options)).rejects.toThrow(
			"reviewed bytes",
		);
		expect(
			(globalThis as Record<string, unknown>).__rocutUntrustedFxExecuted,
		).toBeUndefined();
	} finally {
		if (
			dirname(directory) !== parent ||
			!basename(directory).startsWith("rocut-fx-loader-test-")
		)
			throw Error("Unsafe FX loader test cleanup");
		await rm(directory, { recursive: true, force: true });
	}
});

test.skipIf(!process.env.ROCUT_TEST_HYPERFRAMES_TOOLCHAIN)(
	"real pinned FX module and returned script have reviewed identities",
	async () => {
		const runtime = await loadHyperframesFxRuntime({
			toolchainDirectory: process.env.ROCUT_TEST_HYPERFRAMES_TOOLCHAIN!,
			signal: new AbortController().signal,
		});
		expect(runtime.sha256).toBe(HYPERFRAMES_FX_NATIVE.codeSha256);
		expect(runtime.moduleSha256).toBe(HYPERFRAMES_FX_NATIVE.moduleSha256);
		expect(runtime.code).toContain("window.__HF_AUDIO_FX={render:");
		expect(runtime.packageLockSha256).toMatch(/^[a-f0-9]{64}$/);
		expect(() => assertHyperframesFxRuntime(runtime)).not.toThrow();
		expect(() => assertHyperframesFxRuntime({ ...runtime })).toThrow(
			"reviewed native runtime",
		);
		expect(() =>
			assertHyperframesFxRuntime({ ...runtime, code: runtime.code + "\n" }),
		).toThrow("reviewed native runtime");
	},
);

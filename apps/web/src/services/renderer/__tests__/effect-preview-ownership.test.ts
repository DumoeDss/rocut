import { expect, mock, test } from "bun:test";
import { fileURLToPath } from "node:url";

if (process.env.OPENCUT_EFFECT_PREVIEW_TEST_ISOLATED !== "1") {
	test("effect preview ownership runs in an isolated WASM mock process", () => {
		const result = Bun.spawnSync({
			cmd: [process.execPath, "test", fileURLToPath(import.meta.url)],
			cwd: process.cwd(),
			env: {
				...process.env,
				OPENCUT_EFFECT_PREVIEW_TEST_ISOLATED: "1",
			},
			stderr: "pipe",
			stdout: "pipe",
		});
		if (result.exitCode !== 0) {
			throw new Error(
				`isolated effect preview ownership suite failed:\n${result.stderr.toString()}`,
			);
		}
	});
} else {
	mock.module("opencut-wasm", () => ({
		applyEffectPasses: ({ source }: { source: OffscreenCanvas }) => source,
		applyMaskFeather: ({ mask }: { mask: OffscreenCanvas }) => mask,
		formatTimecode: ({ time }: { time: number }) => String(time),
		initializeGpu: async () => false,
		lastFrameTime: ({ duration }: { duration: number }) => duration,
		mediaTimeFromSeconds: ({ seconds }: { seconds: number }) =>
			Math.round(seconds * 120_000),
		mediaTimeToSeconds: ({ time }: { time: number }) => time / 120_000,
		parseTimecode: () => null,
		roundToFrame: ({ time }: { time: number }) => Math.round(time),
		snappedSeekTime: ({ time }: { time: number }) => time,
		TICKS_PER_SECOND: () => 120_000,
		WasmRuntimeGraphicsQuery: class {
			selectedBackend() {
				return null;
			}
			free() {}
		},
	}));

	const { BrowserAssetResolver } =
		await import("@/editor/host/browser-runtime");
	const { getEffectPreviewSource } = await import("../effect-preview-source");
	const { acquireEffectPreviewService, releaseEffectPreviewService } =
		await import("../effect-preview");

	test("recreates source and service state after the final resolver owner releases", () => {
		const resolver = new BrowserAssetResolver("/final-owner/");
		const firstSource = getEffectPreviewSource({ resolver });
		const firstOwner = acquireEffectPreviewService({ resolver });
		const secondOwner = acquireEffectPreviewService({ resolver });

		expect(secondOwner).toBe(firstOwner);
		releaseEffectPreviewService({ resolver });
		expect(getEffectPreviewSource({ resolver })).toBe(firstSource);

		releaseEffectPreviewService({ resolver });
		const recreatedSource = getEffectPreviewSource({ resolver });
		const recreatedOwner = acquireEffectPreviewService({ resolver });
		expect(recreatedSource).not.toBe(firstSource);
		expect(recreatedOwner).not.toBe(firstOwner);
		expect(recreatedOwner.previewImageUrl).toBe(
			"/final-owner/effects/preview.jpg",
		);
		releaseEffectPreviewService({ resolver });
	});
}

import { expect, test } from "bun:test";
import { launchFrameBrowser } from "../programmatic/chromium-process";
import { createHyperframesFxTarget } from "../programmatic/hyperframes-fx-target";

// Optional real-browser negative control, no toolchain or unknown positive DSP.
const executable = process.env.ROCUT_TEST_HYPERFRAMES_FX_BROWSER;
test.skipIf(!executable)(
	"real private Chromium rejects unknown data/blob worklets and retains OfflineAudioContext",
	async () => {
		const controller = new AbortController();
		const timer = setTimeout(
			() => controller.abort(Error("DSP target smoke timeout")),
			20000,
		);
		const browser = await launchFrameBrowser(executable!, controller.signal);
		try {
			const target = await createHyperframesFxTarget(
				browser,
				controller.signal,
				(error) => controller.abort(error),
			);
			try {
				const result = await target.evaluate(`(async () => {
				const context = new OfflineAudioContext(1, 32, 48000);
				const unknown = 'data:text/javascript;base64,' + btoa("registerProcessor('unreviewed', class extends AudioWorkletProcessor { process(){ return true; } });");
				let dataRejected = false, blobRejected = false;
				try { await context.audioWorklet.addModule(unknown); } catch { dataRejected = true; }
				const blob = URL.createObjectURL(new Blob(["registerProcessor('unreviewed', class extends AudioWorkletProcessor { process(){ return true; } });"], { type: 'text/javascript' }));
				try { await context.audioWorklet.addModule(blob); } catch { blobRejected = true; } finally { URL.revokeObjectURL(blob); }
				const output = await context.startRendering();
				return { secure: isSecureContext, origin: location.origin, dataRejected, blobRejected, frames: output.length, sampleRate: output.sampleRate, zero: output.getChannelData(0).every(value => value === 0) };
			})()`);
				expect(result).toEqual({
					secure: true,
					origin: "https://rocut-native-fx.invalid",
					dataRejected: true,
					blobRejected: true,
					frames: 32,
					sampleRate: 48000,
					zero: true,
				});
			} finally {
				await target.close();
			}
		} finally {
			clearTimeout(timer);
			await browser.close();
		}
	},
	30000,
);

// Diagnostic instrumentation of the browser's public decoder API only. It is
// confined to a dedicated E2E iframe and restored after the performance probe.
export async function traceVideoDecoder(page, hardwareAcceleration = null) {
	await page.evaluate((hardwareAcceleration) => {
		const NativeDecoder = window.VideoDecoder;
		window.__rocutNativeVideoDecoder = NativeDecoder;
		const mark = (kind, value) => {
			const state = window.__rocutVisibleSeekProbe;
			if (!state || state.start === null) return;
			const trace = (state.decoderTrace ??= {
				submitted: 0,
				output: 0,
				created: 0,
			});
			trace[kind]++;
			if (kind === "output") {
				const now = performance.now() - state.start;
				trace.firstOutputMs ??= now;
				trace.lastOutputMs = now;
				trace.lastTimestampUs = value;
			}
		};
		window.VideoDecoder = class extends NativeDecoder {
			constructor(init) {
				super({
					...init,
					output: (frame) => {
						mark("output", frame.timestamp);
						init.output(frame);
					},
				});
				mark("created");
			}
			decode(chunk) {
				mark("submitted");
				return super.decode(chunk);
			}
			configure(config) {
				return super.configure(
					hardwareAcceleration ? { ...config, hardwareAcceleration } : config,
				);
			}
		};
	}, hardwareAcceleration);
	return () =>
		page.evaluate(() => {
			window.VideoDecoder = window.__rocutNativeVideoDecoder;
			delete window.__rocutNativeVideoDecoder;
		});
}

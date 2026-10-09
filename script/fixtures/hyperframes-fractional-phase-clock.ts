import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { digest } from "./hyperframes-variable-rate-io";
import type { RateLane } from "./hyperframes-variable-rate-native";

/** Original DOM synchronization with an IO-only element stub. This establishes
 * fractional loop CLOCKS, not continuous MediaElement PCM or an exporter loop. */
export async function fractionalLoopClock(toolchain: string) {
	const core = join(toolchain, "node_modules/@hyperframes/core");
	const manifest = JSON.parse(
		await readFile(join(core, "package.json"), "utf8"),
	);
	assert.equal(manifest.version, "0.8.139");
	const native = await import(
		pathToFileURL(join(core, "dist/runtime/media.js")).href
	);
	const speed = await import(
		pathToFileURL(join(core, "dist/speedRamp.js")).href
	);
	const automation = await import(
		pathToFileURL(join(core, "dist/audioAutomation.js")).href
	);
	const rate: RateLane = automation.normalizeAutomation({
		version: 1,
		lanes: [
			{
				target: "rate",
				points: [
					{ t: 0, v: 0.7, curve: 0.4 },
					{ t: 2, v: 1.8 },
				],
			},
		],
	}).lanes[0];
	const results = [];
	for (const sampleRate of [48000, 44100])
		for (const fraction of [0.25, 0.75]) {
			const mediaStart = 0.1 + fraction / sampleRate;
			const sourceDuration = 0.35,
				period = sourceDuration - mediaStart;
			const start = 0.2 + 0.3 / sampleRate,
				duration = 2 + 0.4 / sampleRate;
			const samples = [];
			for (const elapsed of [0.37, 0.63, 0.93, 1.27, 1.49, 1.91]) {
				const el = {
					tagName: "AUDIO",
					isConnected: true,
					loop: true,
					duration: sourceDuration,
					currentTime: 0,
					playbackRate: 1,
					volume: 1,
					muted: false,
					paused: true,
					ended: false,
					preload: "auto",
					readyState: 4,
					HAVE_CURRENT_DATA: 2,
					networkState: 1,
					NETWORK_LOADING: 2,
					closest: () => null,
					ownerDocument: {},
					getAttribute: (name: string) =>
						name === "data-automation"
							? JSON.stringify({
									version: 1,
									lanes: [{ target: "volume", points: [{ t: 0, v: 1 }] }],
								})
							: null,
				};
				native.syncRuntimeMedia({
					clips: [
						{
							el,
							start,
							end: start + duration,
							duration,
							sourceDuration,
							mediaStart,
							rate,
							playbackRate: 1,
							loop: true,
							volume: 1,
							fades: { fadeIn: 0, fadeOut: 0 },
						},
					],
					timeSeconds: start + elapsed,
					getCompositionDuration: () => start + duration,
					playbackRate: 1,
					playing: false,
					forceSync: true,
					outputMuted: true,
				});
				const consumed = speed.sourceTimeAt(rate, start + elapsed - start);
				const expected = mediaStart + (consumed % period);
				assert.ok(Math.abs(el.currentTime - expected) < 2e-14);
				const roundedPeriod = Math.round(period * 48000) / 48000;
				const graphPeriod = Math.round(period * sampleRate) / sampleRate;
				samples.push({
					elapsed,
					consumed,
					actual: el.currentTime,
					expected,
					roundedNativePeriodError: Math.abs(
						el.currentTime - (mediaStart + (consumed % roundedPeriod)),
					),
					roundedGraphPeriodError: Math.abs(
						el.currentTime - (mediaStart + (consumed % graphPeriod)),
					),
				});
			}
			assert.ok(
				samples.some((value) => value.roundedNativePeriodError * 48000 > 0.5),
			);
			assert.ok(
				samples.some(
					(value) => value.roundedGraphPeriodError * sampleRate > 0.5,
				),
			);
			results.push({
				sampleRate,
				fraction,
				start,
				mediaStart,
				duration,
				period,
				samples,
			});
		}
	return {
		boundary:
			"Pinned native source clock only; IO stub, no native loop PCM or source-loop production acceptance.",
		sourceSha256: digest(await readFile(join(core, "dist/runtime/media.js"))),
		rate,
		results,
	};
}

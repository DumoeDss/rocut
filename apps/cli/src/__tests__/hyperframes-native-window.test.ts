import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as wasm from "opencut-wasm";

const toolchain = process.env.ROCUT_TEST_HYPERFRAMES_TOOLCHAIN;
const storage = new DataView(new ArrayBuffer(8));
function adjacent(value: number, delta: bigint) {
	storage.setFloat64(0, value);
	storage.setBigUint64(0, storage.getBigUint64(0) + delta);
	return storage.getFloat64(0);
}
function graph(start: number, end: number, time = 0, observed = false) {
	return {
		version: 1,
		semanticsProfile: "rocut-hyperframes-0.8.139-audio-graph-v1",
		frameRate: { numerator: 25, denominator: 1 },
		sampleRate: 48000,
		firstFrame: 0,
		frameCount: 25,
		durationFrames: 25,
		sources: [{ id: "a".repeat(64), mimeType: "audio/wav", byteLength: 4096 }],
		snapshot: {
			version: 1,
			nativeVersion: "0.8.139",
			time,
			buses: [],
			tracks: [
				{
					instanceId: "track#1",
					authorId: "voice",
					resourceId: "a".repeat(64),
					type: "audio",
					authoredMuted: false,
					ancestorHidden: false,
					observedAt: time,
					native: {
						start,
						end,
						duration: end - start,
						mediaStart: 0,
						sourceDuration: 0.1,
						playbackRate: 1,
						rate: 1,
						loop: false,
						volume: 1,
						fades: { fadeIn: 0, fadeOut: 0 },
						volumeKeyframes: [{ time: 0, volume: 1 }],
					},
					resolvedAuthorGain: observed
						? {
								state: "observed",
								observedAt: time,
								gainBeforeFades: 1,
								source: "normalized-GSAP",
								points: [{ t: 0, v: 1 }],
								fades: { fadeIn: 0, fadeOut: 0 },
								fallback: null,
							}
						: { state: "unobserved" },
					attributes: {
						groupRenderId: null,
						groupAuthorId: null,
						fxChain: null,
						automation: null,
						muted: false,
						hasAudio: null,
					},
				},
			],
		},
	};
}

test.skipIf(!toolchain)(
	"native floating-point clip windows match upstream discovery and gain admission",
	async () => {
		const core = join(toolchain!, "node_modules/@hyperframes/core");
		expect(
			JSON.parse(await readFile(join(core, "package.json"), "utf8")).version,
		).toBe("0.8.139");
		const { isInClipWindow, hasClipStarted } = await import(
			pathToFileURL(join(core, "dist/runtime/clipWindow.js")).href
		);
		const { instantTolerance } = await import(
			pathToFileURL(join(core, "dist/clipFacts.js")).href
		);
		let earlyDiscoveries = 0,
			inactive = 0,
			cases = 0;
		for (const start of [
			0,
			Number.MIN_VALUE,
			0.00001,
			0.05,
			0.5,
			adjacent(1, -1n),
			1,
			adjacent(1, 1n),
			2,
		]) {
			for (const ulps of [0n, 1n, 2n, 4n, 8n, 12n, 16n, 32n, 128n]) {
				const end = adjacent(start, ulps);
				const result = JSON.parse(
					wasm.resolveHyperframesAudioDiscoveryJson(
						JSON.stringify(graph(start, end)),
					),
				);
				expect(result.error).toBeUndefined();
				const seeks = result.plan.seeks;
				if (seeks.length) {
					const time = seeks[0].time;
					expect(time >= 0 && time < 1).toBe(true);
					expect(isInClipWindow(time, start, end)).toBe(true);
					if (time < start) {
						earlyDiscoveries++;
						if (time > 0)
							expect(hasClipStarted(adjacent(time, -1n), start)).toBe(false);
					}
				} else {
					inactive++;
					// Independently scan neighboring doubles around BOTH native tolerance
					// thresholds, rather than duplicating Rust's bitwise binary search.
					for (const center of [
						start,
						end,
						Math.max(0, start - instantTolerance(start)),
						Math.max(0, end - instantTolerance(end)),
					]) {
						for (let offset = -4n; offset <= 4n; offset++) {
							if (center === 0 && offset < 0) continue;
							const candidate = adjacent(center, offset);
							if (candidate >= 0 && candidate < 1)
								expect(isInClipWindow(candidate, start, end)).toBe(false);
						}
					}
				}
				expect(result.plan.boundaryLimitedInstanceIds).toEqual([]);
				cases++;
			}
		}
		expect(cases).toBe(81);
		expect(earlyDiscoveries).toBeGreaterThan(0);
		expect(inactive).toBeGreaterThan(0);
		for (const start of [0.05, 0.5]) {
			const end = start + 0.04;
			for (const time of [
				adjacent(start, -1n),
				start - 2e-15,
				start,
				start + 0.02,
				adjacent(end, -1n),
				end,
			]) {
				const input = {
					version: 1,
					graph: graph(start, end, time, true),
					faderObservations: [],
				};
				const result = JSON.parse(
					wasm.resolveHyperframesAudioExecutionPlanJson(JSON.stringify(input)),
				);
				expect(result.error === undefined).toBe(
					isInClipWindow(time, start, end),
				);
				if (result.plan)
					expect(result.plan.tracks[0].startSample).toBe(start * 48000);
			}
		}
	},
);

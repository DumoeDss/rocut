import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { variableRateCases } from "./hyperframes-variable-rate-cases";
import { digest } from "./hyperframes-variable-rate-io";
import type { RateLane, RateSpec } from "./hyperframes-variable-rate-native";

/** Calls unchanged native synchronization with an IO-only media-element stub.
 * This proves requested seek/rate clocks, not actual browser PCM or playback. */
export async function nativeVariableLoopClock(toolchain: string) {
	const core = join(toolchain, "node_modules/@hyperframes/core");
	const manifest = JSON.parse(
		await readFile(join(core, "package.json"), "utf8"),
	);
	assert.equal(manifest.version, "0.8.139");
	const sourceFiles = [
		"dist/runtime/media.js",
		"dist/speedRamp.js",
		"dist/audioAutomation.js",
		"dist/runtime/audioAutomationVolume.js",
	];
	const sourceSha256 = Object.fromEntries(
		await Promise.all(
			sourceFiles.map(async (name) => [
				name,
				digest(await readFile(join(core, name))),
			]),
		),
	);
	const speed: {
		rateAt(rate: RateSpec, time: number): number;
		sourceTimeAt(rate: RateSpec, time: number): number;
		timeAtSourceTime(rate: RateSpec, time: number): number;
	} = await import(pathToFileURL(join(core, "dist/speedRamp.js")).href);
	const automation: {
		normalizeAutomation(value: { version: 1; lanes: RateLane[] }): {
			lanes: RateLane[];
		};
	} = await import(pathToFileURL(join(core, "dist/audioAutomation.js")).href);
	const native: { syncRuntimeMedia(params: unknown): void } = await import(
		pathToFileURL(join(core, "dist/runtime/media.js")).href
	);
	const mediaStart = 0.1,
		sourceDuration = 0.35,
		period = 0.25,
		duration = 1.6,
		start = 0.2;
	const cases = [];
	for (const test of variableRateCases.filter(
		(value) => typeof value.rate === "object",
	)) {
		const rate = automation.normalizeAutomation({
			version: 1,
			lanes: [test.rate as RateLane],
		}).lanes[0];
		const firstLapSeconds = speed.timeAtSourceTime(rate, period);
		const times = [
			0.01,
			0.13,
			0.37,
			0.63,
			0.93,
			1.27,
			1.49,
			firstLapSeconds - 0.0001,
			firstLapSeconds + 0.0001,
			speed.timeAtSourceTime(rate, period * 2) - 0.0001,
			speed.timeAtSourceTime(rate, period * 2) + 0.0001,
		];
		const samples = [];
		for (const elapsed of times.filter(
			(time) => time >= 0 && time < duration,
		)) {
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
			const elapsedAtNativeClock = start + elapsed - start;
			const consumed = speed.sourceTimeAt(rate, elapsedAtNativeClock);
			const expected = mediaStart + (consumed % period);
			assert.ok(
				Math.abs(el.currentTime - expected) < 2e-14,
				`${test.id}: native source-wrap phase`,
			);
			assert.ok(
				Math.abs(el.playbackRate - speed.rateAt(rate, elapsedAtNativeClock)) <
					2e-14,
				`${test.id}: rate clock never resets on wrap`,
			);
			const repeatedPreparedPhase =
				mediaStart +
				speed.sourceTimeAt(rate, elapsedAtNativeClock % firstLapSeconds);
			const sourceZeroLoopPhase = (consumed + mediaStart) % sourceDuration;
			samples.push({
				elapsed,
				consumed,
				actualPhase: el.currentTime,
				actualRate: el.playbackRate,
				repeatedPreparedError: Math.abs(repeatedPreparedPhase - el.currentTime),
				sourceZeroLoopError: Math.abs(sourceZeroLoopPhase - el.currentTime),
			});
		}
		const repeatedPreparedError = Math.max(
			...samples.map((sample) => sample.repeatedPreparedError),
		);
		const sourceZeroLoopError = Math.max(
			...samples.map((sample) => sample.sourceZeroLoopError),
		);
		assert.ok(
			repeatedPreparedError > 0.02,
			"Repeating a prepared first lap is observably wrong",
		);
		assert.ok(
			sourceZeroLoopError > 0.05,
			"Looping the untrimmed source is observably wrong",
		);
		cases.push({
			id: test.id,
			rate,
			firstLapSeconds,
			samples,
			repeatedPreparedError,
			sourceZeroLoopError,
		});
	}
	return {
		status: "passed",
		boundary:
			"Unmodified native syncRuntimeMedia with IO-only element stub; requested source positions/rates only, no real browser playback or PCM. Native export loop behavior is separate.",
		coreVersion: manifest.version,
		sourceSha256,
		mediaStart,
		sourceDuration,
		duration,
		cases,
	};
}

if (import.meta.main) {
	const toolchain = process.env.ROCUT_TEST_HYPERFRAMES_TOOLCHAIN;
	assert.ok(toolchain && isAbsolute(toolchain));
	const report = await nativeVariableLoopClock(toolchain);
	const directory = await mkdtemp(join(tmpdir(), "rocut-hf-rate-loop-clock-"));
	await writeFile(
		join(directory, "verification.json"),
		JSON.stringify(report, null, 2) + "\n",
		{ flag: "wx" },
	);
	console.log(
		JSON.stringify({
			status: report.status,
			report: join(directory, "verification.json"),
			cases: report.cases.map((value) => ({
				id: value.id,
				repeatedPreparedError: value.repeatedPreparedError,
				sourceZeroLoopError: value.sourceZeroLoopError,
			})),
		}),
	);
}

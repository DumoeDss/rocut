/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- focused manager fixture intentionally supplies only the collaborators PlaybackManager reads. */
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	spyOn,
	test,
} from "bun:test";
import { fileURLToPath } from "node:url";

import type { TimerHandle } from "../../../editor/session/resources";

if (process.env.OPENCUT_PLAYBACK_RANGE_TEST_ISOLATED !== "1") {
	test("playback range suite runs in an isolated wasm-mock process", () => {
		const result = Bun.spawnSync({
			cmd: [process.execPath, "test", fileURLToPath(import.meta.url)],
			cwd: process.cwd(),
			env: {
				...process.env,
				OPENCUT_PLAYBACK_RANGE_TEST_ISOLATED: "1",
			},
			stderr: "pipe",
			stdout: "pipe",
		});
		if (result.exitCode !== 0) {
			throw new Error(
				`isolated playback range suite failed:\n${result.stdout.toString()}\n${result.stderr.toString()}`,
			);
		}
	});
} else {
	await import("../../../editor/session/__tests__/wasm-test-mock");
	const { PlaybackManager } = await import("../playback-manager");

	interface Fixture {
		readonly playback: InstanceType<typeof PlaybackManager>;
		setDuration(duration: number): void;
		setAudioClock(seconds: number | null): void;
		flushTimelineChange(): void;
		flushAnimationFrame(): void;
	}

	function createFixture(): Fixture {
		let duration = 1_200_000;
		let audioClock: number | null = null;
		let frameHandler: (() => void) | null = null;
		const timelineListeners = new Set<() => void>();
		const sceneListeners = new Set<() => void>();
		const timerHandle: TimerHandle = {
			resourceId: "timer-1",
			kind: "animationFrame",
			cancel: mock(() => {}),
		};
		const editor = {
			audio: { getPlaybackClockTime: () => audioClock },
			timeline: {
				getTotalDuration: () => duration,
				subscribe: (listener: () => void) => {
					timelineListeners.add(listener);
					return () => timelineListeners.delete(listener);
				},
			},
			scenes: {
				subscribe: (listener: () => void) => {
					sceneListeners.add(listener);
					return () => sceneListeners.delete(listener);
				},
			},
			project: { getActive: () => null },
			resources: {
				requestAnimationFrame: ({ handler }: { handler: () => void }) => {
					frameHandler = handler;
					return timerHandle;
				},
			},
		};
		const playback = new PlaybackManager(editor as never);
		playback.bindTimelineScope();
		return {
			playback,
			setAudioClock(seconds) {
				audioClock = seconds;
			},
			setDuration(nextDuration) {
				duration = nextDuration;
			},
			flushTimelineChange() {
				for (const listener of timelineListeners) listener();
			},
			flushAnimationFrame() {
				const handler = frameHandler;
				frameHandler = null;
				if (handler) handler();
			},
		};
	}

	let now = 0;
	let nowSpy: ReturnType<typeof spyOn>;

	beforeEach(() => {
		now = 0;
		nowSpy = spyOn(performance, "now").mockImplementation(() => now);
	});

	afterEach(() => {
		nowSpy.mockRestore();
	});

	describe("PlaybackManager audio clock", () => {
		test("a delayed device does not consume or truncate a short clip", () => {
			const fixture = createFixture();
			fixture.setDuration(240_000);
			fixture.setAudioClock(0);
			fixture.playback.play();
			now = 3_000;
			fixture.flushAnimationFrame();
			expect(fixture.playback.getCurrentTime()).toBe(0);
			expect(fixture.playback.getIsPlaying()).toBe(true);
			fixture.setAudioClock(1.5);
			now = 4_500;
			fixture.flushAnimationFrame();
			expect(fixture.playback.getCurrentTime()).toBe(180_000);
			expect(fixture.playback.getIsPlaying()).toBe(true);
			fixture.setAudioClock(2);
			fixture.flushAnimationFrame();
			expect(fixture.playback.getCurrentTime()).toBe(240_000);
			expect(fixture.playback.getIsPlaying()).toBe(false);
		});

		test("video-only playback still uses elapsed wall time", () => {
			const fixture = createFixture();
			fixture.playback.play();
			now = 1_500;
			fixture.flushAnimationFrame();
			expect(fixture.playback.getCurrentTime()).toBe(180_000);
		});

		test("removing the audio clock does not jump over its startup wait", () => {
			const fixture = createFixture();
			fixture.setAudioClock(0);
			fixture.playback.play();
			now = 3_000;
			fixture.flushAnimationFrame();
			fixture.setAudioClock(0.5);
			now = 3_500;
			fixture.flushAnimationFrame();
			fixture.setAudioClock(null);
			now = 3_600;
			fixture.flushAnimationFrame();
			expect(fixture.playback.getCurrentTime()).toBe(72_000);
		});

		test("audio loop boundaries follow audio time, not delayed wall time", () => {
			const fixture = createFixture();
			fixture.playback.setLoopRange({
				range: { startTime: 240_000 as never, endTime: 480_000 as never },
			});
			fixture.setAudioClock(2);
			fixture.playback.play();
			now = 9_000;
			fixture.flushAnimationFrame();
			expect(fixture.playback.getCurrentTime()).toBe(240_000);
			fixture.setAudioClock(3.5);
			fixture.flushAnimationFrame();
			expect(fixture.playback.getCurrentTime()).toBe(420_000);
			fixture.setAudioClock(4);
			fixture.flushAnimationFrame();
			expect(fixture.playback.getCurrentTime()).toBe(240_000);
			expect(fixture.playback.getIsPlaying()).toBe(true);
		});

		test("pause cancels updates while the native clock continues", () => {
			const fixture = createFixture();
			fixture.setAudioClock(1);
			fixture.playback.play();
			fixture.playback.pause();
			fixture.setAudioClock(9);
			now = 9_000;
			fixture.flushAnimationFrame();
			expect(fixture.playback.getCurrentTime()).toBe(120_000);
			expect(fixture.playback.getIsPlaying()).toBe(false);
		});
	});
	describe("PlaybackManager loop range", () => {
		test("setting a range outside the playhead seeks to its inclusive start", () => {
			const fixture = createFixture();
			const seeks: number[] = [];
			fixture.playback.onSeek((time) => seeks.push(time));
			fixture.playback.seek({ time: 900_000 as never });
			seeks.length = 0;

			fixture.playback.setLoopRange({
				range: { startTime: 240_000 as never, endTime: 480_000 as never },
			});

			expect(fixture.playback.getLoopRange()).toEqual({
				startTime: 240_000,
				endTime: 480_000,
			});
			expect(fixture.playback.getCurrentTime()).toBe(240_000);
			expect(seeks).toEqual([240_000]);
		});

		test("crossing the exclusive end loops and publishes a seek for audio", () => {
			const fixture = createFixture();
			const seeks: number[] = [];
			fixture.playback.onSeek((time) => seeks.push(time));
			fixture.playback.setLoopRange({
				range: { startTime: 240_000 as never, endTime: 480_000 as never },
			});
			fixture.playback.play();
			seeks.length = 0;

			now = 2_100;
			fixture.flushAnimationFrame();

			expect(fixture.playback.getIsPlaying()).toBe(true);
			expect(fixture.playback.getCurrentTime()).toBe(240_000);
			expect(seeks).toEqual([240_000]);
		});

		test("timeline shrink clears an invalid loop range and clamps normally", () => {
			const fixture = createFixture();
			fixture.playback.setLoopRange({
				range: { startTime: 240_000 as never, endTime: 480_000 as never },
			});
			fixture.playback.seek({ time: 400_000 as never });
			fixture.setDuration(360_000);
			fixture.flushTimelineChange();

			expect(fixture.playback.getLoopRange()).toBeNull();
			expect(fixture.playback.getCurrentTime()).toBe(360_000);
		});

		test("rejects empty and out-of-timeline ranges without replacing state", () => {
			const fixture = createFixture();
			fixture.playback.setLoopRange({
				range: { startTime: 120_000 as never, endTime: 240_000 as never },
			});

			expect(() =>
				fixture.playback.setLoopRange({
					range: { startTime: 300_000 as never, endTime: 300_000 as never },
				}),
			).toThrow(/must be after/);
			expect(() =>
				fixture.playback.setLoopRange({
					range: { startTime: 300_000 as never, endTime: 1_200_001 as never },
				}),
			).toThrow(/exceeds/);
			expect(fixture.playback.getLoopRange()).toEqual({
				startTime: 120_000,
				endTime: 240_000,
			});
		});

		test("dispose clears the session-owned range", () => {
			const fixture = createFixture();
			fixture.playback.setLoopRange({
				range: { startTime: 120_000 as never, endTime: 240_000 as never },
			});
			fixture.playback.dispose();
			expect(fixture.playback.getLoopRange()).toBeNull();
		});
	});
}

import assert from "node:assert/strict";
import { test as check } from "node:test";
import vm from "node:vm";
import { fixture, driver } from "./hyperframes-native-seek-test-fixture.mjs";

// Pure CPU event-order checks over the repository's unchanged production strings.
// No browser, GPU, private toolchain, source-PTS oracle, or extended deadline.
await check(
	"Falsy abort reasons remain failures for both seek and frame waiter",
	async () => {
		for (const reason of [0, false]) {
			const f = fixture();
			const abort = new AbortController();
			f.begin({ signal: abort.signal });
			const pending = f.context.rocutMedia.nativeSeek(f.video, 0.18);
			const waiting = f.context.rocutMedia.waitNativeFrame(
				new Promise(() => {}),
			);
			abort.abort(reason);
			await pending.then(
				() => assert.fail("seek resolved"),
				(actual) => assert.equal(actual, reason),
			);
			await waiting.then(
				() => assert.fail("frame resolved"),
				(actual) => assert.equal(actual, reason),
			);
			assert.throws(
				() => f.context.rocutMedia.nativeSeek(f.video, 0.2),
				(actual) => actual === reason,
			);
			assert.equal(f.callbacks.size, 0);
			assert.equal(f.liveListeners(), 0);
			f.close();
		}
	},
);

await check(
	"Captured scope tokens prevent closed work from draining or closing its successor",
	async () => {
		const f = fixture();
		const oldScope = f.begin();
		f.context.rocutMedia.endNativeFrame(oldScope);
		const newScope = f.begin();
		await assert.rejects(
			f.context.rocutMedia.drainNativeFrame(oldScope),
			/closed or replaced/,
		);
		f.context.rocutMedia.endNativeFrame(oldScope);
		f.context.rocutMedia.assertNativeFrame(newScope);
		f.context.rocutMedia.endNativeFrame(newScope);
	},
);

await check(
	"Expired driver work cannot reseek GPU/video through a later frame scope",
	async () => {
		const f = fixture({ autoPresent: true });
		const timers = new Map();
		let timerId = 0,
			calls = 0,
			releaseFirst,
			releaseSecond;
		const firstBarrier = new Promise((resolve) => {
			releaseFirst = resolve;
		});
		const secondBarrier = new Promise((resolve) => {
			releaseSecond = resolve;
		});
		const reseeks = [];
		f.context.setTimeout = (callback, milliseconds) => {
			timers.set(++timerId, { callback, milliseconds });
			return timerId;
		};
		f.context.clearTimeout = (id) => timers.delete(id);
		f.context.__hfWaitForSeekCompletion = () =>
			++calls === 1
				? firstBarrier
				: calls === 2
					? secondBarrier
					: Promise.resolve();
		f.context.__hfReseekGpu = (time) => {
			reseeks.push(time);
			f.context.rocutMedia.nativeSeek(f.video, time);
		};
		const until = async (predicate) => {
			for (let count = 0; count < 200; count++) {
				if (predicate()) return;
				await Promise.resolve();
			}
			throw Error("CPU sequencing condition not reached");
		};
		vm.runInContext(driver, f.context);
		const frame = (time) => ({
			frameRate: { numerator: 100, denominator: 1 },
			time,
		});
		try {
			const expired = f.context.rocut.renderFrame(frame(0.23));
			await until(() => calls === 1);
			const deadline = [...timers.values()].find(
				(timer) => timer.milliseconds === 8000,
			);
			assert.ok(deadline);
			f.setNow(8000);
			deadline.callback();
			await assert.rejects(expired, /presentation timed out/);
			const recovery = f.context.rocut.renderFrame(frame(0.31));
			await until(() => calls === 2);
			const beforeRelease = f.log.length;
			releaseFirst();
			for (let count = 0; count < 200; count++) await Promise.resolve();
			assert.deepEqual(reseeks, []);
			assert.equal(f.log.length, beforeRelease);
			assert.equal(f.video.currentTime, 0.18);
			releaseSecond();
			await recovery;
			assert.deepEqual(reseeks, [0.31]);
			assert.equal(f.video.currentTime, 0.31);
			assert.equal(f.callbacks.size, 0);
			assert.equal(f.liveListeners(), 0);
		} finally {
			releaseFirst();
			releaseSecond();
			f.close();
		}
	},
);

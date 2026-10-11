import assert from "node:assert/strict";
import { test as check } from "node:test";
import vm from "node:vm";
import { fixture, driver } from "./hyperframes-native-seek-test-fixture.mjs";

// Pure CPU event-order checks over the repository's unchanged production strings.
// No browser, GPU, private toolchain, source-PTS oracle, or extended deadline.
await check(
	"Observer is installed before setter; stale in-flight picture does not settle command",
	async () => {
		const f = fixture();
		f.begin();
		let settled = false;
		const promise = f.context.rocutMedia.nativeSeek(f.video, 0.18).then(() => {
			settled = true;
		});
		assert.deepEqual(f.log.slice(0, 2), [
			["observe", 1],
			["assign", 0.18],
		]);
		f.video.present(0);
		await Promise.resolve();
		assert.equal(settled, false);
		f.video.land();
		f.video.present(0.18);
		await promise;
		await f.context.rocutMedia.drainNativeFrame();
		assert.equal(f.video.presentedMarker, 18);
		assert.equal(f.liveListeners(), 0);
		f.close();
	},
);

await check(
	"Paused initial zero is fenced; repeated callback-proven same command needs no new presentation",
	async () => {
		const f = fixture();
		f.begin();
		const first = f.context.rocutMedia.nativeSeek(f.video, 0);
		f.video.land();
		f.video.present(0);
		await first;
		const observations = f.log.length;
		await f.context.rocutMedia.nativeSeek(f.video, 0);
		assert.equal(f.log.length, observations);
		await f.context.rocutMedia.drainNativeFrame();
		f.close();
	},
);

await check(
	"Identical pending command coalesces; newer native target supersedes old ownership",
	async () => {
		const f = fixture();
		f.begin();
		const first = f.context.rocutMedia.nativeSeek(f.video, 0.1);
		const obsoleteCallback = [...f.callbacks.values()][0];
		assert.equal(f.context.rocutMedia.nativeSeek(f.video, 0.1), first);
		const latest = f.context.rocutMedia.nativeSeek(f.video, 0.18);
		await first;
		assert.equal(f.callbacks.size, 1);
		obsoleteCallback(0, { mediaTime: 0.1 });
		assert.equal(f.callbacks.size, 1);
		f.video.land();
		f.video.present(0.18);
		await latest;
		await f.context.rocutMedia.drainNativeFrame();
		f.close();
	},
);

await check(
	"Abort rejects the command and retained drain; listeners/callbacks are retired",
	async () => {
		const f = fixture();
		const abort = new AbortController();
		f.begin({ signal: abort.signal });
		const pending = f.context.rocutMedia.nativeSeek(f.video, 0.18);
		abort.abort(Error("cpu abort"));
		await assert.rejects(pending, /cpu abort/);
		await assert.rejects(f.context.rocutMedia.drainNativeFrame(), /cpu abort/);
		assert.equal(f.callbacks.size, 0);
		assert.equal(f.liveListeners(), 0);
		f.close();
	},
);

await check(
	"Native decode error is retained even without upstream awaiting nativeSeek",
	async () => {
		const f = fixture();
		f.begin();
		f.context.rocutMedia.nativeSeek(f.video, 0.18);
		f.video.emit("error");
		await Promise.resolve();
		await assert.rejects(
			f.context.rocutMedia.drainNativeFrame(),
			/decode failed or aborted/,
		);
		assert.equal(f.callbacks.size, 0);
		assert.equal(f.liveListeners(), 0);
		f.close();
	},
);

await check(
	"Missing rVFC fails closed before any native setter; no readiness-only fallback",
	async () => {
		const f = fixture({ supported: false });
		assert.throws(() => f.begin(), /requires requestVideoFrameCallback/);
		assert.equal(f.log.length, 0);
		f.close();
	},
);

await check(
	"Native synchronous target error remains failed even if upstream swallows it",
	async () => {
		const f = fixture();
		f.begin();
		assert.throws(
			() => f.context.rocutMedia.nativeSeek(f.video, 0.6),
			/outside the source/,
		);
		await assert.rejects(
			f.context.rocutMedia.drainNativeFrame(),
			/outside the source/,
		);
		f.close();
	},
);

await check(
	"Original frame deadline remains hard bound; closure rejects unfinished work",
	async () => {
		const f = fixture();
		f.begin();
		f.setNow(8000);
		assert.throws(
			() => f.context.rocutMedia.nativeSeek(f.video, 0.18),
			/deadline expired/,
		);
		await assert.rejects(
			f.context.rocutMedia.drainNativeFrame(),
			/deadline expired/,
		);
		f.close();
		const g = fixture();
		g.begin();
		const pending = g.context.rocutMedia.nativeSeek(g.video, 0.18);
		g.close();
		await assert.rejects(pending, /fence closed/);
		assert.equal(g.callbacks.size, 0);
		assert.equal(g.liveListeners(), 0);
	},
);

await check(
	"No presented callback rejects at the remaining deadline rather than using a fallback",
	async () => {
		const f = fixture();
		f.begin({ deadline: 5 });
		const pending = f.context.rocutMedia.nativeSeek(f.video, 0.18);
		await assert.rejects(pending, /presentation timed out/);
		await assert.rejects(
			f.context.rocutMedia.drainNativeFrame(),
			/presentation timed out/,
		);
		assert.equal(f.callbacks.size, 0);
		assert.equal(f.liveListeners(), 0);
		f.close();
	},
);

await check(
	"Fixed native frame deadline also bounds a permanently pending upstream barrier",
	async () => {
		const f = fixture();
		f.begin({ deadline: 5 });
		await assert.rejects(
			f.context.rocutMedia.waitNativeFrame(new Promise(() => {})),
			/presentation timed out/,
		);
		f.close();
	},
);

await check(
	"After-seeked late callback from a pre-assignment submission cannot own the target",
	async () => {
		const f = fixture();
		f.begin();
		f.setNow(10);
		let settled = false;
		const pending = f.context.rocutMedia.nativeSeek(f.video, 0.18).then(() => {
			settled = true;
		});
		f.setNow(12);
		f.video.land();
		f.setNow(13);
		f.video.present(0, {
			presentationTime: 2,
			expectedDisplayTime: 3,
			presentedFrames: 4,
			width: 64,
			height: 32,
			processingDuration: 0.001,
		});
		await Promise.resolve();
		assert.equal(settled, false);
		assert.equal(f.callbacks.size, 1);
		f.video.present(0.18, { presentationTime: 13, presentedFrames: 5 });
		await pending;
		await f.context.rocutMedia.drainNativeFrame();
		f.close();
	},
);

await check(
	"Presentation counter must advance across different native commands in one frame",
	async () => {
		const f = fixture();
		f.begin();
		const first = f.context.rocutMedia.nativeSeek(f.video, 0);
		f.video.land();
		f.video.present(0, { presentedFrames: 4 });
		await first;
		f.setNow(10);
		let settled = false;
		const pending = f.context.rocutMedia.nativeSeek(f.video, 0.18).then(() => {
			settled = true;
		});
		f.video.land();
		f.setNow(12);
		f.video.present(0, { presentationTime: 11, presentedFrames: 4 });
		await Promise.resolve();
		assert.equal(settled, false);
		f.video.present(0.18, { presentationTime: 12, presentedFrames: 5 });
		await pending;
		f.close();
	},
);

await check(
	"VFR control accepts owned presentation PTS .17 for native requested time .18",
	async () => {
		const f = fixture();
		f.begin();
		f.setNow(10);
		const pending = f.context.rocutMedia.nativeSeek(f.video, 0.18);
		f.setNow(12);
		f.video.land();
		f.setNow(13);
		f.video.present(0.17, { presentationTime: 11, presentedFrames: 5 });
		const result = await pending;
		assert.equal(result.target, 0.18);
		assert.equal(result.mediaTime, 0.17);
		await f.context.rocutMedia.drainNativeFrame();
		f.close();
	},
);

await check(
	"Failed frame rejects later native commands without setters or additional ownership",
	async () => {
		const f = fixture();
		f.begin();
		const first = f.context.rocutMedia.nativeSeek(f.video, 0.1);
		f.video.emit("error");
		await assert.rejects(first, /decode failed/);
		const count = f.log.length;
		assert.throws(
			() => f.context.rocutMedia.nativeSeek(f.video, 0.18),
			/decode failed/,
		);
		assert.equal(f.log.length, count);
		assert.equal(f.callbacks.size, 0);
		assert.equal(f.liveListeners(), 0);
		f.close();
	},
);

await check(
	"Frame closure rejects a pending upstream waiter even when there are no seek jobs",
	async () => {
		const f = fixture();
		f.begin();
		const waiting = f.context.rocutMedia.waitNativeFrame(new Promise(() => {}));
		f.close();
		await assert.rejects(waiting, /fence closed/);
	},
);

await check(
	"Missing presentation ownership metadata fails closed instead of using currentTime",
	async () => {
		const f = fixture();
		f.begin();
		const pending = f.context.rocutMedia.nativeSeek(f.video, 0.18);
		f.video.land();
		f.video.present(0.18, { presentationTime: undefined });
		await assert.rejects(pending, /omitted presentation ownership/);
		f.close();
	},
);

await check(
	"Candidate production driver drains native setter intent before capture readiness",
	async () => {
		const f = fixture({ autoPresent: true });
		vm.runInContext(driver, f.context);
		await f.context.rocut.renderFrame({
			frameRate: { numerator: 100, denominator: 1 },
			time: 0.23,
		});
		assert.equal(f.video.presentedMarker, 18);
		assert.equal(f.callbacks.size, 0);
		assert.equal(f.liveListeners(), 0);
		assert.equal(f.log.filter(([type]) => type === "assign").length, 2);
	},
);

import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { driver, fixture } from "./hyperframes-native-seek-test-fixture.mjs";

for (const event of ["abort", "emptied"]) {
	test(`Healthy queued ${event} does not fail or satisfy native presentation`, async () => {
		const f = fixture();
		f.video.networkState = 2;
		f.begin();
		let settled = false;
		const pending = f.context.rocutMedia.nativeSeek(f.video, 0.18).then(() => {
			settled = true;
		});
		f.video.emit(event);
		await Promise.resolve();
		f.context.rocutMedia.assertNativeFrame();
		assert.equal(settled, false);
		assert.equal(f.callbacks.size, 1);
		f.video.present(0.18);
		await Promise.resolve();
		assert.equal(settled, false);
		f.video.land();
		f.video.present(0.18);
		await pending;
		await f.context.rocutMedia.drainNativeFrame();
		assert.equal(f.callbacks.size, 0);
		assert.equal(f.liveListeners(), 0);
		f.close();
	});

	test(`${event} with MediaError is terminal and retains scoped diagnostics`, async () => {
		const f = fixture();
		f.video.networkState = 3;
		f.begin();
		const pending = f.context.rocutMedia.nativeSeek(f.video, 0.18);
		f.video.error = { code: 1 };
		f.video.emit(event);
		await assert.rejects(pending, (error) => {
			assert.match(error.message, /decode failed \(code 1\)/);
			assert.ok(error.message.includes(`event ${event}`));
			assert.match(
				error.message,
				/mediaErrorCode 1, readyState 2, networkState 3, sameSource true/,
			);
			assert.ok(!error.message.includes(f.video.src));
			return true;
		});
		await assert.rejects(
			f.context.rocutMedia.drainNativeFrame(),
			/decode failed/,
		);
		assert.equal(f.callbacks.size, 0);
		assert.equal(f.liveListeners(), 0);
		f.close();
	});
}

test("Reset lifecycle stays pending through empty readiness and stale submission", async () => {
	const f = fixture();
	f.begin();
	f.setNow(10);
	let settled = false;
	const pending = f.context.rocutMedia.nativeSeek(f.video, 0.18).then(() => {
		settled = true;
	});
	f.video.readyState = 0;
	f.video.duration = NaN;
	f.video.networkState = 2;
	f.video.emit("abort");
	f.video.emit("emptied");
	// This is an old submission, not a fresh post-reset seeking candidate.
	f.video.present(0, { presentationTime: 2, presentedFrames: 3 });
	await Promise.resolve();
	assert.equal(settled, false);
	f.video.readyState = 2;
	f.video.duration = 0.6;
	f.video.land();
	f.setNow(12);
	f.video.present(0, { presentationTime: 2, presentedFrames: 4 });
	await Promise.resolve();
	assert.equal(settled, false);
	f.video.present(0.17, { presentationTime: 12, presentedFrames: 5 });
	const result = await pending;
	assert.equal(result, undefined);
	assert.equal(settled, true);
	await f.context.rocutMedia.drainNativeFrame();
	f.close();
});

test("Fresh reset callback at readyState zero remains a candidate until readiness and seeked", async () => {
	const f = fixture();
	const scope = f.begin();
	f.setNow(10);
	let settled = false;
	const pending = f.context.rocutMedia.nativeSeek(f.video, 0.18).then((value) => {
		settled = true;
		return value;
	});
	f.video.readyState = 0;
	f.video.duration = NaN;
	f.video.networkState = 2;
	f.video.emit("abort");
	f.video.emit("emptied");
	f.setNow(12);
	f.video.present(0.17, { presentationTime: 12, presentedFrames: 3 });
	await Promise.resolve();
	assert.equal(settled, false);
	assert.equal(scope.presentations.size, 0);
	f.video.readyState = 2;
	f.video.duration = 0.6;
	f.video.emit("canplay");
	await Promise.resolve();
	assert.equal(settled, false);
	f.video.land();
	const result = await pending;
	assert.equal(result.target, 0.18);
	assert.equal(result.mediaTime, 0.17);
	assert.equal(result.presentationTime, 12);
	assert.equal(result.presentedFrames, 3);
	assert.equal(f.callbacks.size, 0);
	assert.equal(f.liveListeners(), 0);
	await f.context.rocutMedia.drainNativeFrame();
	f.close();
});

test("Healthy media lifecycle never extends the original presentation deadline", async () => {
	const f = fixture();
	f.begin({ deadline: 5 });
	const pending = f.context.rocutMedia.nativeSeek(f.video, 0.18);
	f.video.emit("abort");
	f.video.emit("emptied");
	await assert.rejects(pending, /presentation timed out/);
	await assert.rejects(
		f.context.rocutMedia.drainNativeFrame(),
		/presentation timed out/,
	);
	assert.equal(f.callbacks.size, 0);
	assert.equal(f.liveListeners(), 0);
	f.close();
});

test("True frame abort remains terminal after healthy media lifecycle events", async () => {
	const f = fixture();
	const abort = new AbortController();
	f.begin({ signal: abort.signal });
	const pending = f.context.rocutMedia.nativeSeek(f.video, 0.18);
	f.video.emit("abort");
	f.video.emit("emptied");
	abort.abort(Error("owned frame aborted"));
	await assert.rejects(pending, /owned frame aborted/);
	assert.equal(f.callbacks.size, 0);
	assert.equal(f.liveListeners(), 0);
	f.close();
});

test("Error event without MediaError still fails with a redacted source-ownership diagnostic", async () => {
	const f = fixture();
	f.begin();
	const pending = f.context.rocutMedia.nativeSeek(f.video, 0.18);
	f.video.currentSrc = "data:video/webm;base64,BAUG";
	f.video.emit("error");
	await assert.rejects(pending, (error) => {
		assert.match(error.message, /decode failed without MediaError/);
		assert.match(error.message, /event error, mediaErrorCode none/);
		assert.match(error.message, /sameSource false/);
		assert.ok(!error.message.includes(f.video.src));
		assert.ok(!error.message.includes(f.video.currentSrc));
		return true;
	});
	f.close();
});

test("Healthy lifecycle does not bypass source policy or cursor ownership", async () => {
	const f = fixture();
	f.begin();
	const pending = f.context.rocutMedia.nativeSeek(f.video, 0.18);
	f.video.currentSrc = "https://invalid.example/private-source.webm";
	f.video.emit("emptied");
	await assert.rejects(
		pending,
		/declared inline MP4\/WebM asset.*event emptied/,
	);
	f.close();
	const g = fixture();
	g.begin();
	const drifted = g.context.rocutMedia.nativeSeek(g.video, 0.18);
	g.video.emit("abort");
	g.video._time = 0.17;
	g.video.land();
	g.video.present(0.17);
	await assert.rejects(drifted, /seek target changed before presentation/);
	g.close();
});

test("Healthy lifecycle for a different inline source fails command ownership", async () => {
	const f = fixture();
	f.video.networkState = 2;
	f.begin();
	const pending = f.context.rocutMedia.nativeSeek(f.video, 0.18);
	f.video.src = f.video.currentSrc = "data:video/webm;base64,BAUG";
	f.video.emit("emptied");
	await assert.rejects(pending, (error) => {
		assert.match(error.message, /source changed during seek.*event emptied/);
		assert.match(error.message, /mediaErrorCode none.*sameSource false/);
		assert.ok(!error.message.includes(f.video.src));
		return true;
	});
	await assert.rejects(
		f.context.rocutMedia.drainNativeFrame(),
		/source changed/,
	);
	assert.equal(f.callbacks.size, 0);
	assert.equal(f.liveListeners(), 0);
	f.close();
});

test("Production driver tolerates queued load events during its first zero seek", async () => {
	const f = fixture({ autoPresent: true });
	vm.runInContext(driver, f.context);
	const descriptor = Object.getOwnPropertyDescriptor(
		Object.getPrototypeOf(f.video),
		"currentTime",
	);
	Object.defineProperty(f.video, "currentTime", {
		get() {
			return descriptor.get.call(this);
		},
		set(value) {
			queueMicrotask(() => {
				f.video.emit("abort");
				f.video.emit("emptied");
			});
			descriptor.set.call(this, value);
		},
	});
	const render = f.context.rocut.renderFrame({
		frameRate: { numerator: 100, denominator: 1 },
		time: 0.23,
	});
	await render;
	assert.equal(f.video.presentedMarker, 18);
	assert.equal(f.callbacks.size, 0);
	assert.equal(f.liveListeners(), 0);
	assert.equal(f.log.filter(([type]) => type === "assign").length, 2);
});

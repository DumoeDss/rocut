import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./hyperframes-native-seek-test-fixture.mjs";

function controlled() {
	const f = fixture(),
		timers = new Map();
	let id = 0;
	f.context.setTimeout = (callback, delay) => {
		timers.set(++id, { callback, delay });
		return id;
	};
	f.context.clearTimeout = (token) => timers.delete(token);
	const scope = f.begin();
	return { ...f, scope, timers, fire: (token) => timers.get(token).callback() };
}
const flush = async () => {
	for (let i = 0; i < 8; i++) await Promise.resolve();
};
function noEventPresentation(f, mediaTime = 0, overrides = {}) {
	f.video.seeking = false;
	f.video.present(mediaTime, overrides);
}

test("Initial zero accepts a fresh owned presentation without seeked, not readiness alone", async () => {
	const f = controlled();
	f.setNow(10);
	let settled = false;
	const result = f.context.rocutMedia.nativeSeek(f.video, 0).then((value) => {
		settled = true;
		return value;
	});
	f.video.seeking = false;
	await flush();
	assert.equal(settled, false);
	assert.deepEqual(f.log, [
		["observe", 1],
		["assign", 0],
	]);
	noEventPresentation(f);
	const picture = await result;
	assert.equal(picture.target, 0);
	assert.equal(picture.presentationTime, 10);
	assert.equal(f.scope.states.get(f.video).observe().landed, false);
	assert.equal(f.callbacks.size, 0);
	assert.equal(f.liveListeners(), 0);
	await f.context.rocutMedia.drainNativeFrame();
	f.close();
});

test("Initial zero accepts its only valid callback before a later seeked event", async () => {
	const f = controlled();
	f.setNow(10);
	const result = f.context.rocutMedia.nativeSeek(f.video, 0);
	f.setNow(12);
	noEventPresentation(f);
	await result;
	f.video.land();
	assert.equal(f.callbacks.size, 0);
	f.close();
});

test("Initial zero still rejects stale submission, missing ownership and source replacement", async () => {
	for (const mode of ["stale", "missing", "source"]) {
		const f = controlled();
		f.setNow(10);
		let settled = false;
		const result = f.context.rocutMedia.nativeSeek(f.video, 0).then(
			() => {
				settled = true;
			},
			(error) => error,
		);
		if (mode === "source") f.video.src = "data:video/webm;base64,OTHER";
		const overrides =
			mode === "stale"
				? { presentationTime: 9 }
				: mode === "missing"
					? { presentedFrames: undefined }
					: {};
		noEventPresentation(f, 0, overrides);
		await flush();
		assert.equal(settled, false);
		if (mode === "stale") {
			assert.equal(f.callbacks.size, 1);
			noEventPresentation(f);
			await result;
		} else
			assert.match(
				(await result).message,
				mode === "source" ? /source changed/ : /presentation ownership/,
			);
		f.close();
	}
});

test("No-op initial zero retains advancing presentation counter and original deadline", async () => {
	for (const mode of ["counter", "no-callback"]) {
		const f = controlled();
		f.setNow(100);
		if (mode === "counter")
			f.scope.presentations.set(f.video, { presentedFrames: 2 });
		let settled = false;
		const result = f.context.rocutMedia.nativeSeek(f.video, 0).then(
			() => {
				settled = true;
			},
			(error) => error,
		);
		assert.equal(f.timers.get(1).delay, 8000);
		assert.equal(f.timers.get(2).delay, 7900);
		if (mode === "counter") noEventPresentation(f, 0, { presentedFrames: 2 });
		else f.video.seeking = false;
		await flush();
		assert.equal(settled, false);
		f.fire(1);
		assert.match((await result).message, /presentation timed out/);
		f.close();
	}
});

test("Nonzero no-op, zero movement, active seek and later zero command still require seeked", async () => {
	for (const mode of [
		"nonzero-noop",
		"zero-movement",
		"already-seeking",
		"later-zero",
	]) {
		const f = controlled();
		if (mode === "nonzero-noop" || mode === "zero-movement")
			f.video._time = 0.18;
		if (mode === "already-seeking") f.video.seeking = true;
		if (mode === "later-zero") {
			const first = f.context.rocutMedia.nativeSeek(f.video, 0.18);
			f.video.land();
			f.video.present(0.18);
			await first;
			f.video._time = 0;
		}
		const target = mode === "nonzero-noop" ? 0.18 : 0;
		let settled = false;
		const result = f.context.rocutMedia.nativeSeek(f.video, target).then(() => {
			settled = true;
		});
		noEventPresentation(f, target);
		await flush();
		assert.equal(settled, false);
		assert.equal(f.callbacks.size, 1);
		f.video.land();
		f.video.present(target);
		await result;
		f.close();
	}
});

test("Initial zero remains pending while seeking and closure remains terminal", async () => {
	const f = controlled();
	let settled = false;
	const result = f.context.rocutMedia.nativeSeek(f.video, 0).then(
		() => {
			settled = true;
		},
		(error) => error,
	);
	f.video.present(0);
	await flush();
	assert.equal(settled, false);
	f.close();
	assert.match((await result).message, /frame fence closed/);
});

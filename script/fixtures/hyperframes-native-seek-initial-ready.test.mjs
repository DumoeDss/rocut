import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./hyperframes-native-seek-test-fixture.mjs";

test("validated primitive copy cannot retain a stale last-read presentation timestamp", async () => {
	const f = controlled();
	let reads = 0;
	const p = retain(f, {
		mediaTime: 0,
		presentedFrames: 1,
		get presentationTime() {
			return ++reads < 4 ? 11 : 9;
		},
	}).catch((error) => error);
	f.video.readyState = 2;
	f.video.emit("canplay");
	assert.equal(f.scope.presentations.size, 0);
	f.timeout();
	assert.match((await p).message, /timed out/);
	f.close();
});
test("validated primitive copy rejects invalid last-read ownership counter", async () => {
	const f = controlled();
	let reads = 0;
	const p = retain(f, {
		mediaTime: 0,
		presentationTime: 11,
		get presentedFrames() {
			return ++reads < 3 ? 1 : NaN;
		},
	}).catch((error) => error);
	assert.match((await p).message, /omitted presentation ownership/);
	assert.equal(f.callbacks.size, 0);
	f.close();
});
test("retained proof does not let unchanged currentSrc hide declared markup mutation", async () => {
	const f = controlled(),
		p = retain(f).catch((error) => error);
	f.video.src = "data:video/webm;base64,BAUG";
	f.video.readyState = 2;
	f.video.emit("canplay");
	assert.match((await p).message, /source changed/);
	assert.equal(f.scope.presentations.size, 0);
	f.close();
});

function controlled(options = {}) {
	const f = fixture(),
		timers = new Map();
	let token = 0;
	f.context.setTimeout = (callback, delay) => {
		timers.set(++token, { callback, delay });
		return token;
	};
	f.context.clearTimeout = (id) => timers.delete(id);
	const scope = f.begin(options);
	return { ...f, scope, timers, timeout: () => timers.get(1).callback() };
}
function submit(
	f,
	metadata = { mediaTime: 0, presentationTime: 11, presentedFrames: 1 },
) {
	const [id, callback] = [...f.callbacks][0];
	f.callbacks.delete(id);
	callback(0, metadata);
}
function retain(f, metadata) {
	f.setNow(10);
	const promise = f.context.rocutMedia.nativeSeek(f.video, 0);
	f.video.seeking = false;
	f.video.readyState = 1;
	submit(f, metadata);
	return promise;
}
const schedules = (f) => f.log.map((entry) => entry[0]);
for (const event of ["loadeddata", "canplay", "seeked"])
	test(
		"one eligible zero callback is admitted by existing " +
			event +
			" event after ready improves",
		async () => {
			const f = controlled(),
				p = retain(f);
			assert.deepEqual(schedules(f), ["observe", "assign", "observe"]);
			assert.equal(f.callbacks.size, 1);
			assert.equal(f.scope.presentations.size, 0);
			f.video.readyState = 2;
			f.video.emit(event);
			const result = await p;
			assert.equal(result.target, 0);
			assert.equal(result.mediaTime, 0);
			assert.equal(result.presentationTime, 11);
			assert.equal(result.presentedFrames, 1);
			assert.equal(f.callbacks.size, 0);
			assert.equal(f.liveListeners(), 0);
			assert.equal(f.timers.size, 1);
			assert.deepEqual(schedules(f), ["observe", "assign", "observe"]);
			f.close();
			assert.equal(f.timers.size, 0);
		},
	);
test("ready improvement without any callback proof remains insufficient", async () => {
	// Covered by the separately frozen baseline A/B runner; this test checks the
	// candidate also cannot accept a ready event that has no callback proof.
	const f = controlled();
	f.setNow(10);
	const p = f.context.rocutMedia.nativeSeek(f.video, 0).catch((e) => e);
	f.video.seeking = false;
	f.video.readyState = 2;
	f.video.emit("loadeddata");
	assert.equal(f.scope.presentations.size, 0);
	f.timeout();
	assert.match((await p).message, /timed out/);
	f.close();
});
test("ready event never rereads original metadata or accepts changed cached primitives", async () => {
	const f = controlled(),
		values = { mediaTime: 0, presentationTime: 11, presentedFrames: 1 },
		reads = {};
	const metadata = {};
	for (const property of Object.keys(values))
		Object.defineProperty(metadata, property, {
			configurable: true,
			get() {
				reads[property] = (reads[property] ?? 0) + 1;
				return values[property];
			},
		});
	const p = retain(f, metadata),
		before = { ...reads };
	for (const property of Object.keys(values))
		Object.defineProperty(metadata, property, {
			get() {
				throw Error("metadata reread");
			},
		});
	f.video.readyState = 2;
	f.video.emit("canplay");
	const result = await p;
	assert.deepEqual(reads, before);
	assert.equal(result.presentationTime, 11);
	assert(Object.isFrozen(result));
	f.close();
});
test("ready remaining low preserves original deadline and pending callback", async () => {
	const f = controlled(),
		p = retain(f).catch((e) => e);
	for (const type of ["loadeddata", "canplay", "seeked"]) f.video.emit(type);
	assert.equal(f.scope.presentations.size, 0);
	assert.equal(f.callbacks.size, 1);
	assert.equal(f.timers.get(1).delay, 8000);
	assert.equal(f.timers.get(2).delay, 7990);
	f.timeout();
	assert.match((await p).message, /timed out/);
	assert.equal(f.callbacks.size, 0);
	assert.equal(f.liveListeners(), 0);
	f.close();
});
for (const change of ["source", "target", "unpaused", "decode-error"])
	test(
		"retained proof cannot bypass current " + change + " guard",
		async () => {
			const f = controlled(),
				p = retain(f).catch((e) => e);
			f.video.readyState = 2;
			if (change === "source")
				f.video.currentSrc = "data:video/webm;base64,BAUG";
			if (change === "target") f.video._time = 0.1;
			if (change === "unpaused") f.video.paused = false;
			if (change === "decode-error") f.video.error = { code: 3 };
			f.video.emit("canplay");
			const result = await p;
			assert.equal(typeof result.message, "string");
			assert.match(
				result.message,
				change === "source"
					? /source changed/
					: change === "target"
						? /target changed/
						: change === "unpaused"
							? /paused/
							: /decode failed/,
			);
			assert.equal(f.scope.presentations.size, 0);
			assert.equal(f.callbacks.size, 0);
			assert.equal(f.liveListeners(), 0);
			f.close();
		},
	);
test("ready event while seeking cannot admit, but a later same-source ready event can", async () => {
	const f = controlled(),
		p = retain(f);
	f.video.readyState = 2;
	f.video.seeking = true;
	f.video.emit("loadeddata");
	assert.equal(f.scope.presentations.size, 0);
	assert.equal(f.callbacks.size, 1);
	f.video.seeking = false;
	f.video.emit("canplay");
	await p;
	f.close();
});
for (const reset of ["abort", "emptied"])
	test(
		"same-source " +
			reset +
			" retires retained proof without treating healthy reload as success",
		async () => {
			const f = controlled(),
				p = retain(f).catch((e) => e);
			f.video.emit(reset);
			f.video.readyState = 2;
			f.video.emit("canplay");
			assert.equal(f.scope.presentations.size, 0);
			f.timeout();
			assert.match((await p).message, /timed out/);
			f.close();
		},
	);
for (const metadata of [
	{ mediaTime: 0, presentationTime: 9, presentedFrames: 1 },
	{ mediaTime: 0, presentationTime: 11, presentedFrames: 0 },
])
	test(
		"stale initial callback cannot be rescued by ready-state event " +
			JSON.stringify(metadata),
		async () => {
			const f = controlled();
			if (metadata.presentedFrames === 0)
				f.scope.presentations.set(f.video, {
					target: 0,
					presentationTime: 5,
					presentedFrames: 1,
				});
			const p = retain(f, metadata).catch((e) => e);
			f.video.readyState = 2;
			f.video.emit("canplay");
			f.timeout();
			assert.match((await p).message, /timed out/);
			f.close();
		},
	);
test("freshness is checked again against any newer owned presentation at readiness event", async () => {
	const f = controlled(),
		p = retain(f).catch((e) => e);
	f.scope.presentations.set(f.video, {
		target: 0,
		presentationTime: 12,
		presentedFrames: 2,
	});
	f.video.readyState = 2;
	f.video.emit("canplay");
	assert.equal(f.scope.presentations.get(f.video).presentedFrames, 2);
	f.timeout();
	assert.match((await p).message, /timed out/);
	f.close();
});
test("abort cancels cached evidence, listeners and rearmed callback", async () => {
	const controller = new AbortController(),
		f = controlled({ signal: controller.signal }),
		p = retain(f).catch((e) => e),
		retired = [...f.callbacks.values()][0],
		reason = Error("owned abort");
	controller.abort(reason);
	assert.equal(await p, reason);
	assert.equal(f.callbacks.size, 0);
	assert.equal(f.liveListeners(), 0);
	f.video.readyState = 2;
	f.video.emit("canplay");
	retired(0, { mediaTime: 0, presentationTime: 11, presentedFrames: 1 });
	assert.equal(f.scope.presentations.size, 0);
	f.close();
});
test("expired absolute deadline cannot accept on an event before timer delivery", async () => {
	const f = controlled(),
		p = retain(f).catch((e) => e);
	f.setNow(8000);
	f.video.readyState = 2;
	f.video.emit("loadeddata");
	assert.match((await p).message, /deadline expired/);
	assert.equal(f.callbacks.size, 0);
	assert.equal(f.liveListeners(), 0);
	f.close();
});
test("event admission retires callback and late delivery cannot overwrite evidence", async () => {
	const f = controlled(),
		p = retain(f),
		retired = [...f.callbacks.values()][0];
	f.video.readyState = 2;
	f.video.emit("canplay");
	const result = await p;
	retired(0, {
		get mediaTime() {
			throw Error("retired callback read");
		},
	});
	f.video.emit("loadeddata");
	assert.equal(f.scope.presentations.get(f.video), result);
	assert.equal(f.callbacks.size, 0);
	f.close();
});
test("scope closure cancels retained proof and cannot be revived", async () => {
	const f = controlled(),
		p = retain(f).catch((e) => e),
		retired = [...f.callbacks.values()][0];
	f.close();
	assert.match((await p).message, /fence closed/);
	assert.equal(f.callbacks.size, 0);
	assert.equal(f.liveListeners(), 0);
	f.video.readyState = 2;
	f.video.emit("canplay");
	retired(0, {
		get mediaTime() {
			throw Error("retired callback read");
		},
	});
	assert.equal(f.scope.presentations.size, 0);
});
for (const mode of ["nonzero", "later-zero", "callback-seeking"])
	test(
		mode +
			" remains on original rejection path, cannot cache proof from ready event",
		async () => {
			const f = controlled();
			if (mode === "later-zero") {
				const first = f.context.rocutMedia.nativeSeek(f.video, 0.18);
				f.video.land();
				submit(f, { mediaTime: 0.18, presentationTime: 1, presentedFrames: 1 });
				await first;
			}
			f.setNow(10);
			const p = f.context.rocutMedia
				.nativeSeek(f.video, mode === "nonzero" ? 0.18 : 0)
				.catch((e) => e);
			f.video.readyState = 1;
			if (mode !== "callback-seeking") f.video.land();
			let reads = 0;
			submit(f, {
				get mediaTime() {
					reads++;
					throw Error("unexpected metadata read");
				},
			});
			assert.equal(reads, 0);
			f.video.seeking = false;
			f.video.readyState = 2;
			f.video.emit("canplay");
			f.timeout();
			assert.match((await p).message, /timed out/);
			f.close();
		},
	);
test("eligible zero ready-low path now validates metadata and exposes its original getter fault", async () => {
	const f = controlled(),
		fault = Error("owned getter fault");
	let reads = 0;
	const p = retain(f, {
		get mediaTime() {
			reads++;
			throw fault;
		},
	}).catch((e) => e);
	assert.equal(await p, fault);
	assert.equal(reads, 1);
	assert.equal(f.callbacks.size, 0);
	assert.equal(f.liveListeners(), 0);
	f.close();
});
test("superseded initial proof is retired and cannot admit a following command", async () => {
	const f = controlled(),
		first = retain(f),
		retired = [...f.callbacks.values()][0];
	const second = f.context.rocutMedia.nativeSeek(f.video, 0.18);
	assert.equal(await first, undefined);
	f.video.readyState = 2;
	f.video.seeking = false;
	f.video.emit("canplay");
	assert.equal(f.scope.presentations.size, 0);
	retired(0, {
		get mediaTime() {
			throw Error("old callback read");
		},
	});
	f.video.land();
	submit(f, { mediaTime: 0.18, presentationTime: 12, presentedFrames: 2 });
	assert.equal((await second).target, 0.18);
	f.close();
});

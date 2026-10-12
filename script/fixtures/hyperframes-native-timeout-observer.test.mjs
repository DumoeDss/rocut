import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./hyperframes-native-seek-test-fixture.mjs";

function controlled() {
	const f = fixture(),
		timers = new Map();
	let sequence = 0;
	f.context.setTimeout = (callback, delay) => {
		timers.set(++sequence, { callback, delay });
		return sequence;
	};
	f.context.clearTimeout = (token) => timers.delete(token);
	const scope = f.begin();
	return { ...f, scope, timers, fire: (token) => timers.get(token).callback() };
}
const snapshot = (error) =>
	JSON.parse(
		error.message.slice("HTML native video presentation timed out ".length),
	);
function submit(f, metadata) {
	const [id, callback] = [...f.callbacks][0];
	f.callbacks.delete(id);
	callback(0, metadata);
}

test("Parent error cap retains both accepted and unresolved video's cached gates", async () => {
	const f = controlled(),
		second = new f.context.HTMLVideoElement();
	f.scope.videos.push(second);
	const first = f.context.rocutMedia.nativeSeek(f.video, 0);
	f.video.seeking = false;
	submit(f, { mediaTime: 0, presentationTime: 1, presentedFrames: 1 });
	await first;
	const pending = f.context.rocutMedia
		.nativeSeek(second, 0)
		.catch((error) => error);
	submit(f, { mediaTime: 0, presentationTime: 1, presentedFrames: 1 });
	second.seeking = false;
	f.fire(1);
	const error = await pending,
		data = snapshot(error);
	assert.deepEqual(data.gates, [
		{ ordinal: 0, eligible: true, gate: "accepted", callbackSeeking: false },
		{ ordinal: 1, eligible: true, gate: "seeking", callbackSeeking: true },
	]);
	assert(error.message.slice(0, 1000).includes(JSON.stringify(data.gates)));
	f.close();
});

test("Zero timeout distinguishes initial admission from callback-time seeking without a second frame", async () => {
	for (const mode of ["eligible", "pre-seeking", "pre-current"]) {
		const f = controlled();
		if (mode === "pre-seeking") f.video.seeking = true;
		if (mode === "pre-current") f.video._time = 0.1;
		const result = f.context.rocutMedia
			.nativeSeek(f.video, 0)
			.catch((error) => error);
		// Native assignment leaves seeking true. The only fresh callback is
		// delivered now, before a later seeking=false state without seeked.
		submit(f, { mediaTime: 0, presentationTime: 1, presentedFrames: 1 });
		f.video.seeking = false;
		f.fire(1);
		const error = await result,
			data = snapshot(error),
			seek = data.videos[0].nativeSeek;
		assert.equal(seek.callbackCount, 1);
		assert.equal(seek.armCount, 2);
		assert.equal(seek.initialZero.previousAtCreation, false);
		assert.equal(seek.initialZero.currentTimeRead, true);
		assert.equal(seek.initialZero.eligible, mode === "eligible");
		assert.equal(seek.initialZero.seekingRead, mode !== "pre-current");
		assert.equal(
			seek.callbackGate.reason,
			mode === "eligible" ? "seeking" : "landing",
		);
		assert.equal(seek.callbackGate.seekingRead, mode === "eligible");
		assert.equal(seek.callbackGate.readyStateRead, false);
		assert.equal(data.videos[0].seeking, false);
		assert(!error.message.includes("data:") && !error.message.includes("AQID"));
		f.close();
	}
});

test("Later zero snapshot records previous state and skipped initial DOM reads", async () => {
	const f = controlled();
	const first = f.context.rocutMedia.nativeSeek(f.video, 0.18);
	f.video.land();
	submit(f, { mediaTime: 0.18, presentationTime: 0, presentedFrames: 1 });
	await first;
	const result = f.context.rocutMedia
		.nativeSeek(f.video, 0)
		.catch((error) => error);
	f.video.seeking = false;
	submit(f, { mediaTime: 0, presentationTime: 1, presentedFrames: 2 });
	f.fire(1);
	const seek = snapshot(await result).videos[0].nativeSeek;
	assert.equal(seek.initialZero.previousAtCreation, true);
	assert.equal(seek.initialZero.currentTimeRead, false);
	assert.equal(seek.initialZero.currentTime, null);
	assert.equal(seek.initialZero.seekingRead, false);
	assert.equal(seek.initialZero.seeking, null);
	assert.equal(seek.initialZero.eligible, false);
	assert.equal(seek.callbackGate.reason, "landing");
	f.close();
});

test("Callback diagnostics preserve the first getter fault without extra reads", async () => {
	for (const property of ["mediaTime", "presentationTime", "presentedFrames"]) {
		const f = controlled();
		let reads = 0;
		const fault = Error("first metadata getter fault");
		const metadata = {
			mediaTime: 0.18,
			presentationTime: 0,
			presentedFrames: 1,
		};
		Object.defineProperty(metadata, property, {
			get() {
				reads++;
				throw fault;
			},
		});
		const result = f.context.rocutMedia
			.nativeSeek(f.video, 0.18)
			.catch((error) => error);
		f.video.land();
		submit(f, metadata);
		assert.equal(await result, fault);
		assert.equal(reads, 1);
		f.close();
	}
});

test("Changing ownership getter remains rejected on its original first read", async () => {
	const f = controlled();
	let reads = 0;
	const metadata = { mediaTime: 0.18, presentationTime: 0 };
	Object.defineProperty(metadata, "presentedFrames", {
		get() {
			return ++reads === 1 ? NaN : 1;
		},
	});
	const result = f.context.rocutMedia
		.nativeSeek(f.video, 0.18)
		.catch((error) => error);
	f.video.land();
	submit(f, metadata);
	assert.equal(
		(await result).message,
		"HTML native video callback omitted presentation ownership",
	);
	assert.equal(reads, 1);
	f.close();
});

test("Accepted callback accessors retain original native read counts", async () => {
	const f = controlled(),
		reads = { mediaTime: 0, presentationTime: 0, presentedFrames: 0 };
	const values = { mediaTime: 0.18, presentationTime: 0, presentedFrames: 1 },
		metadata = {};
	for (const property of Object.keys(values))
		Object.defineProperty(metadata, property, {
			get() {
				reads[property]++;
				return values[property];
			},
		});
	const result = f.context.rocutMedia.nativeSeek(f.video, 0.18);
	f.video.land();
	submit(f, metadata);
	assert.equal((await result).mediaTime, 0.18);
	assert.deepEqual(reads, {
		mediaTime: 3,
		presentationTime: 4,
		presentedFrames: 3,
	});
	f.close();
});

test("Diagnostic copy skips own and inherited getters and preserves plain dictionary data", () => {
	const f = controlled(),
		state = { callbackCount: 0 };
	let reads = 0;
	const inherited = Object.create({
		get mediaTime() {
			reads++;
			throw Error("PRIVATE_SOURCE");
		},
	});
	Object.defineProperty(inherited, "presentationTime", {
		get() {
			reads++;
			throw Error("PRIVATE_SOURCE");
		},
	});
	f.context.observeNativeCallback(state, inherited);
	assert.equal(reads, 0);
	assert.equal(
		JSON.stringify(state.lastCallback),
		JSON.stringify({
			mediaTime: null,
			presentationTime: null,
			presentedFrames: null,
		}),
	);
	f.context.observeNativeCallback(state, {
		mediaTime: 0.17,
		presentationTime: 12,
		presentedFrames: 2,
	});
	assert.equal(state.callbackCount, 2);
	assert.equal(
		JSON.stringify(state.lastCallback),
		JSON.stringify({
			mediaTime: 0.17,
			presentationTime: 12,
			presentedFrames: 2,
		}),
	);
	f.close();
});

test("Timeout snapshots retain stage, finite fields and stale callback without asset URLs", async () => {
	const f = controlled();
	f.setNow(10);
	f.scope.stage = "native-seek-drain";
	const result = f.context.rocutMedia
		.nativeSeek(f.video, 0.18)
		.catch((error) => error);
	f.video.land();
	submit(f, { mediaTime: 0.17, presentationTime: 9, presentedFrames: 1 });
	assert.equal(f.callbacks.size, 1);
	f.fire(1);
	const error = await result,
		data = snapshot(error),
		seek = data.videos[0].nativeSeek;
	assert.equal(data.stage, "native-seek-drain");
	assert.equal(seek.target, 0.18);
	assert.equal(seek.assignmentStartedAt, 10);
	assert.equal(seek.callbackCount, 1);
	assert.equal(seek.landed, true);
	assert.deepEqual(seek.lastCallback, {
		mediaTime: 0.17,
		presentationTime: 9,
		presentedFrames: 1,
	});
	assert(
		!error.message.includes("data:") &&
			!error.message.includes("AQID") &&
			!error.message.includes("src"),
	);
	assert.equal(f.callbacks.size, 0);
	assert.equal(f.liveListeners(), 0);
	f.close();
});

test("Global snapshot is fixed numeric data with an allowlisted stage and unchanged deadline", async () => {
	const f = controlled();
	f.scope.stage = "data:video/webm;base64,PRIVATE_ASSET";
	Object.defineProperty(f.video, "duration", {
		get() {
			return { toJSON: () => "PRIVATE_ASSET" };
		},
	});
	const result = f.context.rocutMedia
		.waitNativeFrame(new Promise(() => {}))
		.catch((error) => error);
	assert.equal(f.timers.get(1).delay, 8000);
	f.fire(1);
	const error = await result,
		data = snapshot(error);
	assert.equal(data.stage, "unknown");
	assert.equal(data.videos[0].duration, null);
	assert.equal(data.videos[0].nativeSeek, null);
	assert(
		!error.message.includes("PRIVATE") && !error.message.includes("data:"),
	);
	f.close();
});

test("Snapshot getter faults use fixed fallback and cannot replace an earlier native error", async () => {
	for (const priorFailure of [false, true]) {
		const f = controlled();
		const result = f.context.rocutMedia
			.nativeSeek(f.video, 0.18)
			.catch((error) => error);
		if (priorFailure) {
			f.video.src = "data:video/webm;base64,OTHER";
			f.video.emit("emptied");
		}
		Object.defineProperty(f.video, "duration", {
			get() {
				throw Error("PRIVATE_ASSET_URL");
			},
		});
		assert.doesNotThrow(() => f.fire(1));
		const first = await result;
		if (priorFailure) assert.match(first.message, /source changed/);
		else
			assert.equal(
				first.message,
				'HTML native video presentation timed out {"diagnosticUnavailable":true}',
			);
		assert(!first.message.includes("PRIVATE"));
		assert.throws(
			() => f.context.rocutMedia.assertNativeFrame(f.scope),
			(error) => error === first,
		);
		f.close();
	}
});

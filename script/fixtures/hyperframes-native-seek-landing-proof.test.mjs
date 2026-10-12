import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./hyperframes-native-seek-test-fixture.mjs";

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
const metadata = { mediaTime: 0.37, presentationTime: 1, presentedFrames: 2 };
function submit(f, data = metadata) {
	const [id, callback] = [...f.callbacks][0];
	f.callbacks.delete(id);
	callback(0, data);
	return callback;
}
function start(f, target = 0.37) {
	const result = f.context.rocutMedia
		.nativeSeek(f.video, target)
		.catch((error) => error);
	f.video.seeking = false;
	return result;
}
async function unresolved(f, result) {
	f.timeout();
	assert.match((await result).message, /timed out/);
	f.close();
}
test("Nonzero fresh ready callback before seeked settles only at seeked", async () => {
	const f = controlled(),
		result = start(f);
	let settled = false;
	result.then(() => {
		settled = true;
	});
	const data = { ...metadata };
	submit(f, data);
	assert.equal(f.callbacks.size, 1);
	assert.equal(f.scope.presentations.size, 0);
	await Promise.resolve();
	assert.equal(settled, false);
	data.mediaTime = NaN;
	data.presentationTime = NaN;
	data.presentedFrames = NaN;
	f.video.land();
	assert.equal((await result).mediaTime, 0.37);
	assert.equal(f.callbacks.size, 0);
	assert.equal(f.liveListeners(), 0);
	assert.deepEqual(f.log, [
		["observe", 1],
		["assign", 0.37],
		["observe", 2],
	]);
	f.close();
});
test("Nonzero proof cannot bypass absent seeked via loadeddata or canplay", async () => {
	const f = controlled(),
		result = start(f);
	submit(f);
	f.video.emit("loadeddata");
	f.video.emit("canplay");
	assert.equal(f.scope.presentations.size, 0);
	await unresolved(f, result);
});
test("Fresh seeking callback is retained as a candidate until seeked", async () => {
	const f = controlled(),
		result = start(f);
	f.video.seeking = true;
	submit(f);
	assert.equal(f.scope.presentations.size, 0);
	f.video.land();
	assert.equal((await result).target, 0.37);
	f.close();
});
test("Ready-low nonzero callback cannot be retained by readiness and seeked", async () => {
	const f = controlled(),
		result = start(f);
	f.video.readyState = 1;
	submit(f);
	f.video.readyState = 2;
	f.video.emit("loadeddata");
	f.video.land();
	await unresolved(f, result);
});
test("Later zero retains original landing rejection even if ready and nonseeking", async () => {
	const f = controlled(),
		first = start(f);
	f.video.land();
	submit(f);
	await first;
	const result = start(f, 0);
	submit(f, { mediaTime: 0, presentationTime: 2, presentedFrames: 3 });
	f.video.land();
	await unresolved(f, result);
});
for (const event of ["abort", "emptied"])
	test("Healthy same-source " + event + " retires nonzero proof", async () => {
		const f = controlled(),
			result = start(f);
		submit(f);
		f.video.emit(event);
		f.video.land();
		await unresolved(f, result);
	});
for (const mutation of [
	"source",
	"markup",
	"target",
	"pause",
	"decode",
	"seeking",
	"ready",
])
	test(
		"Seeked revalidates " + mutation + " before nonzero admission",
		async () => {
			const f = controlled(),
				result = start(f);
			submit(f);
			if (mutation === "source")
				f.video.currentSrc = "data:video/webm;base64,BAUG";
			if (mutation === "markup") f.video.src = "data:video/webm;base64,BAUG";
			if (mutation === "target") f.video._time = 0.23;
			if (mutation === "pause") f.video.paused = false;
			if (mutation === "decode") f.video.error = { code: 3 };
			if (mutation === "seeking") f.video.seeking = true;
			if (mutation === "ready") f.video.readyState = 1;
			f.video.emit("seeked");
			if (["seeking", "ready"].includes(mutation)) await unresolved(f, result);
			else {
				assert.match(
					(await result).message,
					/source changed|target changed|paused|decode failed/,
				);
				assert.equal(f.scope.presentations.size, 0);
				f.close();
			}
		},
	);
test("Abort signal retires a retained proof", async () => {
	const signal = new AbortController(),
		f = controlled({ signal: signal.signal }),
		result = start(f);
	submit(f);
	const reason = Error("aborted proof");
	signal.abort(reason);
	f.video.land();
	assert.equal(await result, reason);
	assert.equal(f.scope.presentations.size, 0);
	f.close();
});
test("Deadline cannot be extended by retained proof and seeked", async () => {
	const f = controlled(),
		result = start(f);
	submit(f);
	f.setNow(8000);
	f.video.land();
	assert.match((await result).message, /deadline expired/);
	assert.equal(f.scope.presentations.size, 0);
	f.close();
});
test("Closed scope cannot admit retained proof", async () => {
	const f = controlled(),
		result = start(f);
	submit(f);
	f.close();
	f.video.land();
	assert.match((await result).message, /fence closed/);
	assert.equal(f.scope.presentations.size, 0);
});
test("Superseded proof and delivered obsolete callback cannot settle newer seek", async () => {
	const f = controlled(),
		first = start(f);
	submit(f);
	const obsolete = [...f.callbacks.values()][0];
	const second = start(f, 0.23);
	assert.equal(await first, undefined);
	obsolete(0, metadata);
	f.video.land();
	assert.equal(f.scope.presentations.size, 0);
	submit(f, { mediaTime: 0.23, presentationTime: 2, presentedFrames: 3 });
	assert.equal((await second).target, 0.23);
	f.close();
});
test("Next stale callback retires earlier retained proof", async () => {
	const f = controlled();
	f.setNow(10);
	const result = start(f);
	submit(f, { ...metadata, presentationTime: 11 });
	submit(f, { ...metadata, presentationTime: 9 });
	f.video.land();
	assert.equal(f.scope.presentations.size, 0);
	await unresolved(f, result);
});
test("Submission predating assignment is never retained", async () => {
	const f = controlled();
	f.setNow(10);
	const result = start(f);
	submit(f, { ...metadata, presentationTime: 9 });
	f.video.land();
	await unresolved(f, result);
});
test("Retained counter is revalidated against another newer presentation", async () => {
	const f = controlled(),
		result = start(f);
	submit(f);
	f.scope.presentations.set(f.video, { presentedFrames: 2 });
	f.video.land();
	await unresolved(f, result);
});
test("Nonzero ready retention metadata getters copy primitives once and are not reread at event", async () => {
	const f = controlled(),
		result = start(f),
		reads = { mediaTime: 0, presentationTime: 0, presentedFrames: 0 },
		data = {};
	for (const key of Object.keys(reads))
		Object.defineProperty(data, key, {
			get() {
				reads[key]++;
				return metadata[key];
			},
		});
	submit(f, data);
	const before = { ...reads };
	f.video.land();
	assert.equal((await result).target, 0.37);
	assert.deepEqual(reads, before);
	assert.deepEqual(reads, {
		mediaTime: 3,
		presentationTime: 4,
		presentedFrames: 3,
	});
	f.close();
});
for (const key of ["mediaTime", "presentationTime", "presentedFrames"])
	test(
		"Pre-landing " + key + " first getter fault is terminal, not deferred",
		async () => {
			const f = controlled(),
				result = start(f),
				fault = Error("callback getter " + key),
				data = { ...metadata };
			let reads = 0;
			Object.defineProperty(data, key, {
				get() {
					reads++;
					throw fault;
				},
			});
			submit(f, data);
			f.video.land();
			assert.equal(await result, fault);
			assert.equal(reads, 1);
			f.close();
		},
	);
test("Pre-landing source fault precedes metadata getter fault", async () => {
	const f = controlled(),
		result = start(f),
		data = { ...metadata };
	let reads = 0;
	Object.defineProperty(data, "mediaTime", {
		get() {
			reads++;
			throw Error("metadata");
		},
	});
	f.video.currentSrc = "data:video/webm;base64,BAUG";
	submit(f, data);
	assert.match((await result).message, /source changed/);
	assert.equal(reads, 0);
	f.close();
});
test("Callback with nonzero low-ready or seeking true still skips metadata accessors", async () => {
	for (const denied of ["seeking", "ready"]) {
		const f = controlled(),
			result = start(f),
			data = { ...metadata };
		let reads = 0;
		Object.defineProperty(data, "mediaTime", {
			get() {
				reads++;
				throw Error("unreachable");
			},
		});
		if (denied === "seeking") f.video.seeking = true;
		else f.video.readyState = 1;
		submit(f, data);
		assert.equal(reads, 0);
		f.video.readyState = 2;
		f.video.land();
		await unresolved(f, result);
	}
});

import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./hyperframes-native-seek-test-fixture.mjs";

const original = "data:video/webm;base64,AQID";
const other = "data:video/webm;base64,BAUG";
function source(src = original) {
	return {
		src,
		type: "video/webm",
		media: "",
		getAttribute(name) {
			return this[name] ?? null;
		},
	};
}
function sourceFixture() {
	const f = fixture();
	f.video.src = "";
	f.video.currentSrc = original;
	f.video.sources = [source()];
	f.video.networkState = 2;
	return f;
}

for (const event of ["abort", "emptied"]) {
	test(`Source-only healthy ${event} owns frozen candidates while currentSrc is empty`, async () => {
		const f = sourceFixture();
		f.begin();
		let settled = false;
		const pending = f.context.rocutMedia.nativeSeek(f.video, 0.18).then(() => {
			settled = true;
		});
		f.video.currentSrc = "";
		f.video.readyState = 0;
		f.video.duration = NaN;
		f.video.emit(event);
		f.video.present(0);
		await Promise.resolve();
		f.context.rocutMedia.assertNativeFrame();
		assert.equal(settled, false);
		f.video.duration = 0.6;
		f.video.readyState = 2;
		f.video.currentSrc = original;
		f.video.land();
		f.video.present(0.17);
		await pending;
		assert.equal(settled, true);
		await f.context.rocutMedia.drainNativeFrame();
		assert.equal(f.callbacks.size, 0);
		assert.equal(f.liveListeners(), 0);
		f.close();
	});
}

test("Direct src healthy reload owns frozen declaration while currentSrc is empty", async () => {
	const f = fixture();
	f.begin();
	const pending = f.context.rocutMedia.nativeSeek(f.video, 0.18);
	f.video.currentSrc = "";
	f.video.emit("abort");
	f.video.emit("emptied");
	f.context.rocutMedia.assertNativeFrame();
	f.video.currentSrc = original;
	f.video.land();
	f.video.present(0.18);
	await pending;
	f.close();
});

const sourceChanges = [
	[
		"child URL replacement",
		(video) => {
			video.sources[0].src = other;
		},
	],
	[
		"same-URL child node replacement",
		(video) => {
			video.sources[0] = source();
		},
	],
	[
		"child addition",
		(video) => {
			video.sources.push(source(other));
		},
	],
	[
		"child removal",
		(video) => {
			video.sources = [];
		},
	],
	[
		"child type change",
		(video) => {
			video.sources[0].type = "video/mp4";
		},
	],
	[
		"child media change",
		(video) => {
			video.sources[0].media = "(min-width: 900px)";
		},
	],
	[
		"src attribute addition",
		(video) => {
			video.src = other;
		},
	],
];
for (const [name, mutate] of sourceChanges) {
	test(`Empty selected source does not admit ${name}`, async () => {
		const f = sourceFixture();
		f.begin();
		const pending = f.context.rocutMedia.nativeSeek(f.video, 0.18);
		f.video.currentSrc = "";
		mutate(f.video);
		f.video.emit("emptied");
		await assert.rejects(pending, (error) => {
			assert.match(error.message, /sameSource false/);
			assert.ok(!error.message.includes(original));
			assert.ok(!error.message.includes(other));
			return true;
		});
		await assert.rejects(f.context.rocutMedia.drainNativeFrame());
		assert.equal(f.callbacks.size, 0);
		assert.equal(f.liveListeners(), 0);
		f.close();
	});
}

for (const replacement of [
	other,
	"https://invalid.example/private-source.webm",
]) {
	test(`Old currentSrc cannot hide ${replacement === other ? "inline" : "external"} src mutation`, async () => {
		const f = fixture();
		f.begin();
		const pending = f.context.rocutMedia.nativeSeek(f.video, 0.18);
		f.video.src = replacement;
		assert.equal(f.video.currentSrc, original);
		f.video.emit("abort");
		await assert.rejects(pending, (error) => {
			assert.match(
				error.message,
				/source changed during seek.*sameSource false/,
			);
			assert.ok(!error.message.includes(replacement));
			assert.ok(!error.message.includes(original));
			return true;
		});
		f.close();
	});
}

test("Old currentSrc cannot hide child node mutation", async () => {
	const f = sourceFixture();
	f.begin();
	const pending = f.context.rocutMedia.nativeSeek(f.video, 0.18);
	f.video.sources[0].src = other;
	f.video.emit("abort");
	await assert.rejects(pending, /source changed during seek.*sameSource false/);
	f.close();
});

test("Stable candidates cannot transfer command ownership to a different selection", async () => {
	const f = sourceFixture();
	f.video.sources.push(source(other));
	f.begin();
	const pending = f.context.rocutMedia.nativeSeek(f.video, 0.18);
	f.video.currentSrc = other;
	f.video.emit("emptied");
	await assert.rejects(pending, /source changed during seek.*sameSource false/);
	f.close();
});

test("Same-URL candidate reorder is not stable markup", async () => {
	const f = sourceFixture();
	f.video.sources.push(source());
	f.begin();
	const pending = f.context.rocutMedia.nativeSeek(f.video, 0.18);
	f.video.currentSrc = "";
	f.video.sources.reverse();
	f.video.emit("emptied");
	await assert.rejects(pending, /source changed during seek.*sameSource false/);
	f.close();
});

test("Raw src attribute mutation is rejected even while resolved URL stays the same", async () => {
	const f = fixture();
	let rawSrc = original;
	f.video.getAttribute = (name) => (name === "src" ? rawSrc : null);
	f.begin();
	const pending = f.context.rocutMedia.nativeSeek(f.video, 0.18);
	rawSrc = "data:video/webm;base64,AQID#changed";
	f.video.emit("abort");
	await assert.rejects(pending, /source changed during seek.*sameSource false/);
	f.close();
});

test("Raw child src mutation is rejected even while resolved URL stays the same", async () => {
	const f = sourceFixture();
	const candidate = f.video.sources[0];
	let rawSrc = original;
	const getAttribute = candidate.getAttribute.bind(candidate);
	candidate.getAttribute = (name) =>
		name === "src" ? rawSrc : getAttribute(name);
	f.begin();
	const pending = f.context.rocutMedia.nativeSeek(f.video, 0.18);
	f.video.currentSrc = "";
	rawSrc = "data:video/webm;base64,AQID#changed";
	f.video.emit("emptied");
	await assert.rejects(pending, /source changed during seek.*sameSource false/);
	f.close();
});

test("Presentation cannot own mutated source markup even without a lifecycle event", async () => {
	const f = sourceFixture();
	f.begin();
	const pending = f.context.rocutMedia.nativeSeek(f.video, 0.18);
	f.video.sources[0] = source();
	f.video.land();
	f.video.present(0.18);
	await assert.rejects(
		pending,
		/source changed before presentation.*sameSource false/,
	);
	f.close();
});

test("Completed same-time proof cannot be reused after a declared source mutation", async () => {
	const f = fixture();
	f.begin();
	const pending = f.context.rocutMedia.nativeSeek(f.video, 0.18);
	f.video.land();
	f.video.present(0.18);
	await pending;
	const assignments = f.log.length;
	f.video.src = other;
	assert.throws(
		() => f.context.rocutMedia.nativeSeek(f.video, 0.18),
		/source changed/,
	);
	await assert.rejects(
		f.context.rocutMedia.drainNativeFrame(),
		/source changed/,
	);
	assert.equal(f.log.length, assignments);
	f.close();
});

test("Empty selection cannot own a resource absent from the frozen declarations", async () => {
	const f = sourceFixture();
	f.video.sources[0].src = other;
	f.begin();
	const pending = f.context.rocutMedia.nativeSeek(f.video, 0.18);
	f.video.currentSrc = "";
	f.video.emit("emptied");
	await assert.rejects(pending, /source changed during seek.*sameSource false/);
	f.close();
});

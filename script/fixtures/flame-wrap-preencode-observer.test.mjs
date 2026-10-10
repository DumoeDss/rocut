import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { installFlameWrapPreencodeObserver } from "./flame-wrap-preencode-observer.mjs";

// Explicit platform doubles: these tests do not encode or prove actual WebCodecs pixels.
function fixture() {
	let resolveCopy, rejectCopy;
	const copied = new Promise((resolve, reject) => {
		resolveCopy = resolve;
		rejectCopy = reject;
	});
	const log = [],
		clones = [];
	class VideoFrame {
		constructor(timestamp = 166666) {
			Object.assign(this, {
				timestamp,
				duration: 41667,
				format: "RGBA",
				codedWidth: 2,
				codedHeight: 1,
				displayWidth: 2,
				displayHeight: 1,
				visibleRect: { x: 0, y: 0, width: 2, height: 1 },
				colorSpace: { toJSON: () => ({ matrix: "rgb", fullRange: true }) },
				closed: 0,
			});
		}
		clone() {
			log.push("clone");
			if (this.cloneError) throw this.cloneError;
			const clone = new VideoFrame(this.timestamp);
			clones.push(clone);
			return clone;
		}
		copyTo(bytes, options) {
			log.push({ copy: this, options });
			return copied.then(() => {
				bytes.set([1, 2, 3, 255, 4, 5, 6, 255]);
				return options.layout;
			});
		}
		close() {
			this.closed++;
			log.push({ close: this });
		}
	}
	class VideoEncoder {
		configure(...args) {
			log.push({ configure: this, args });
			return this.result;
		}
		encode(...args) {
			log.push({ encode: this, args });
			if (this.error) throw this.error;
			return this.result;
		}
	}
	const native = VideoEncoder.prototype.encode;
	const context = vm.createContext({
		VideoFrame,
		VideoEncoder,
		Uint8Array,
		structuredClone,
	});
	vm.runInContext(
		`(${installFlameWrapPreencodeObserver.toString()})({timestamp:166666,width:2,height:1})`,
		context,
	);
	return {
		observer: context.__flameWrapPreencodeObserver,
		encoder: new VideoEncoder(),
		frame: new VideoFrame(),
		VideoEncoder,
		native,
		log,
		clones,
		resolveCopy,
		rejectCopy,
		context,
	};
}
const settle = async () => {
	for (let i = 0; i < 5; i++) await Promise.resolve();
};

test("platform double: transparent forwarding and complete only after copy/clone release", async () => {
	const f = fixture(),
		options = { keyFrame: false },
		result = {};
	f.encoder.result = result;
	const config = { codec: "vp09.00.10.08", bitrateMode: "quantizer" };
	assert.equal(f.encoder.configure(config), result);
	assert.equal(f.encoder.encode(f.frame, options), result);
	const call = f.log.find((value) => value.encode);
	assert.equal(call.encode, f.encoder);
	assert.equal(call.args[0], f.frame);
	assert.equal(call.args[1], options);
	assert.equal(f.observer.status().phase, "copying");
	assert.equal(f.observer.read(), null);
	assert.equal(f.frame.closed, 0);
	assert.equal(f.clones[0].closed, 0);
	f.frame.close();
	f.resolveCopy();
	await settle();
	assert.equal(f.observer.status().phase, "complete");
	assert.equal(f.clones[0].closed, 1);
	const sample = f.observer.read();
	assert.deepEqual(Array.from(sample.rgba), [1, 2, 3, 255, 4, 5, 6, 255]);
	assert.equal(sample.timestamp, 166666);
	assert.equal(sample.colorSpace.matrix, "rgb");
	assert.equal(sample.encoderConfig.codec, config.codec);
	assert.equal(sample.encodeOptions.keyFrame, false);
	sample.rgba[0] = 99;
	assert.equal(f.observer.read().rgba[0], 1);
	await f.observer.cleanup();
	assert.equal(f.VideoEncoder.prototype.encode, f.native);
	assert.equal(f.frame.closed, 1);
});

test("platform double: native synchronous failure retains exact exception and releases only clone", async () => {
	const f = fixture(),
		error = new Error("native failure");
	f.encoder.error = error;
	assert.throws(
		() => f.encoder.encode(f.frame),
		(value) => value === error,
	);
	assert.equal(f.frame.closed, 0);
	assert.equal(f.clones[0].closed, 1);
	assert.equal(f.observer.status().phase, "failed");
	assert.equal(f.observer.read(), null);
	await f.observer.cleanup();
});

test("platform double: async copy failure and cleanup cannot report premature success", async () => {
	const f = fixture();
	f.encoder.encode(f.frame);
	let cleaned = false;
	const pending = f.observer.cleanup().then(() => {
		cleaned = true;
	});
	await settle();
	assert.equal(cleaned, false);
	assert.equal(f.clones[0].closed, 0);
	f.rejectCopy(new Error("copy failed"));
	await pending;
	assert.equal(f.observer.status().phase, "failed");
	assert.match(f.observer.status().error, /copy failed/);
	assert.equal(f.clones[0].closed, 1);
	assert.equal(f.frame.closed, 0);
	assert.equal(f.observer.read(), null);
});

test("platform double: clone failure does not prevent native forwarding", async () => {
	const f = fixture();
	f.frame.cloneError = new Error("clone failed");
	f.encoder.result = "native";
	assert.equal(f.encoder.encode(f.frame), "native");
	assert.equal(f.clones.length, 0);
	assert.equal(f.log.filter((value) => value.encode).length, 1);
	assert.equal(f.observer.status().phase, "failed");
	await f.observer.cleanup();
});

test("platform double: non-target frames are untouched; absent point fails closed", async () => {
	const f = fixture();
	f.frame.timestamp = 0;
	f.encoder.encode(f.frame);
	assert.equal(f.clones.length, 0);
	assert.equal(f.frame.closed, 0);
	await f.observer.cleanup();
	assert.match(f.observer.status().error, /not observed/);
});

test("platform double: repeated target invalidates observation without cloning a second frame", async () => {
	const f = fixture();
	f.encoder.encode(f.frame);
	f.encoder.encode(f.frame);
	assert.equal(f.clones.length, 1);
	assert.equal(f.log.filter((value) => value.encode).length, 2);
	f.resolveCopy();
	await f.observer.cleanup();
	assert.equal(f.observer.status().matches, 2);
	assert.equal(f.observer.read(), null);
	assert.match(f.observer.status().error, /Ambiguous/);
	assert.equal(f.clones[0].closed, 1);
});

test("platform double: later hook is preserved; captured frame methods own diagnostic lifetime", async () => {
	const f = fixture();
	f.frame.clone = () => {
		throw new Error("instance clone must not run");
	};
	f.encoder.encode(f.frame);
	const laterHook = () => {};
	f.VideoEncoder.prototype.encode = laterHook;
	f.resolveCopy();
	await f.observer.cleanup();
	assert.equal(f.VideoEncoder.prototype.encode, laterHook);
	assert.equal(f.observer.status().phase, "complete");
	assert.equal(f.clones[0].closed, 1);
	assert.equal(f.frame.closed, 0);
});

test("platform double: missing WebCodecs point rejects installation rather than fabricating a sample", () => {
	assert.throws(
		() =>
			vm.runInNewContext(
				`(${installFlameWrapPreencodeObserver.toString()})({timestamp:166666})`,
				{},
			),
		/observation point unavailable/,
	);
});

import assert from "node:assert/strict";
import test from "node:test";
import { installMasterEncoderTrace } from "./master-encoder-trace.mjs";

function harness({ copyFailure = false, cloneFailure = false } = {}) {
	const calls = [];
	class FakeEncoder {
		configure(config) {
			calls.push(["configure", config]);
		}
		encode(frame, options) {
			calls.push(["encode", frame, options]);
		}
	}
	globalThis.VideoEncoder = FakeEncoder;
	installMasterEncoderTrace();
	let releaseCopy;
	const copied = new Promise((resolve) => {
		releaseCopy = resolve;
	});
	const frame = {
		timestamp: 123,
		duration: 456,
		format: "BGRA",
		codedWidth: 96,
		codedHeight: 64,
		displayWidth: 96,
		displayHeight: 64,
		colorSpace: { toJSON: () => ({ matrix: "rgb" }) },
		clone() {
			calls.push(["clone"]);
			if (cloneFailure) throw Error("closed original frame");
			return {
				allocationSize: () => 4,
				copyTo(bytes) {
					calls.push(["copy"]);
					return copied.then(() => {
						if (copyFailure) throw Error("readback failed");
						bytes.set([1, 2, 3, 255]);
						return [{ offset: 0, stride: 4 }];
					});
				},
				close: () => calls.push(["close clone"]),
			};
		},
		close() {
			throw Error("observer closed caller frame");
		},
	};
	return { encoder: new FakeEncoder(), frame, calls, releaseCopy };
}

test("observer calls native encode with unchanged objects before cloning and never awaits copy", async () => {
	const { encoder, frame, calls, releaseCopy } = harness();
	const config = {
		codec: "vp09.00.10.08",
		bitrate: 56000,
		width: 96,
		height: 64,
	};
	const options = { keyFrame: true };
	encoder.configure(config);
	assert.equal(encoder.encode(frame, options), undefined);
	assert.deepEqual(
		calls.map((entry) => entry[0]),
		["configure", "encode", "clone", "copy"],
	);
	assert.equal(calls[0][1], config);
	assert.equal(calls[1][1], frame);
	assert.equal(calls[1][2], options);
	releaseCopy();
	const trace = await globalThis.__masterEncoderTrace();
	assert.deepEqual(trace.records[0].config, config);
	assert.deepEqual(trace.records[1].bytes, [1, 2, 3, 255]);
	assert.deepEqual(calls.at(-1), ["close clone"]);
});

test("closed-frame clone failure is retained without changing native result", async () => {
	const { encoder, frame, calls } = harness({ cloneFailure: true });
	assert.equal(encoder.encode(frame), undefined);
	const trace = await globalThis.__masterEncoderTrace();
	assert.match(trace.records[0].error, /closed original frame/);
	assert.deepEqual(
		calls.map((entry) => entry[0]),
		["encode", "clone"],
	);
});

test("asynchronous readback failure is retained and diagnostic clone still closes", async () => {
	const { encoder, frame, calls, releaseCopy } = harness({ copyFailure: true });
	encoder.encode(frame);
	releaseCopy();
	const trace = await globalThis.__masterEncoderTrace();
	assert.match(trace.records[0].error, /readback failed/);
	assert.deepEqual(calls.at(-1), ["close clone"]);
});

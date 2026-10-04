import assert from "node:assert/strict";
import { test } from "node:test";
import { createContext, runInContext } from "node:vm";
import { traceVideoDecoder } from "../probe-video-decoder-trace.mjs";

function fixture() {
	class NativeDecoder {
		static isConfigSupported() {
			return true;
		}
		constructor(init) {
			this.init = init;
		}
		configure(config) {
			this.config = config;
		}
		decode(chunk) {
			this.chunk = chunk;
		}
	}
	const context = createContext({
		window: {
			VideoDecoder: NativeDecoder,
			__rocutVisibleSeekProbe: { start: 100 },
		},
		performance: { now: () => 200 },
	});
	const page = {
		evaluate: async (fn, arg) =>
			runInContext(
				"(" + fn.toString() + ")(" + JSON.stringify(arg) + ")",
				context,
			),
	};
	return { NativeDecoder, context, page };
}

test("default trace preserves config, chunks, callbacks and native static API", async () => {
	const { NativeDecoder, context, page } = fixture();
	const restore = await traceVideoDecoder(page);
	try {
		let output;
		const decoder = new context.window.VideoDecoder({
			output: (frame) => {
				output = frame;
			},
		});
		const config = { codec: "avc1.42E01F" };
		const chunk = { timestamp: 42 };
		decoder.configure(config);
		decoder.decode(chunk);
		decoder.init.output(chunk);
		assert.equal(decoder.config, config);
		assert.equal(decoder.chunk, chunk);
		assert.equal(output, chunk);
		assert.equal(
			context.window.VideoDecoder.isConfigSupported,
			NativeDecoder.isConfigSupported,
		);
		assert.deepEqual(
			JSON.parse(
				JSON.stringify(context.window.__rocutVisibleSeekProbe.decoderTrace),
			),
			{
				submitted: 1,
				output: 1,
				created: 1,
				firstOutputMs: 100,
				lastOutputMs: 100,
				lastTimestampUs: 42,
			},
		);
	} finally {
		await restore();
	}
	assert.equal(context.window.VideoDecoder, NativeDecoder);
	assert.equal(context.window.__rocutNativeVideoDecoder, undefined);
});

test("diagnostic hint changes only a cloned configuration and is restorable", async () => {
	const { NativeDecoder, context, page } = fixture();
	const restore = await traceVideoDecoder(page, "prefer-software");
	try {
		const decoder = new context.window.VideoDecoder({ output() {} });
		const config = {
			codec: "avc1.42E01F",
			hardwareAcceleration: "prefer-hardware",
		};
		decoder.configure(config);
		assert.notEqual(decoder.config, config);
		assert.equal(decoder.config.hardwareAcceleration, "prefer-software");
		assert.equal(config.hardwareAcceleration, "prefer-hardware");
	} finally {
		await restore();
	}
	assert.equal(context.window.VideoDecoder, NativeDecoder);
});

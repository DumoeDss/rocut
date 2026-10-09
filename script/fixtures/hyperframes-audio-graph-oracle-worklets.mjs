import assert from "node:assert/strict";
import { createContext, runInContext } from "node:vm";
import { sha256 } from "./hyperframes-audio-graph-oracle-support.mjs";

/** Actual upstream processor PCM, but NOT a browser graph/decoder oracle. */
export async function nativeWorklets(graph) {
	let registrations = 0;
	let source;
	const registry = new Map();
	const context = createContext({
		sampleRate: 48000,
		AudioWorkletProcessor: class {
			port = {};
		},
		registerProcessor: (name, processor) => {
			assert.ok(!registry.has(name), `Duplicate processor: ${name}`);
			registry.set(name, processor);
		},
	});
	const host = {
		audioWorklet: {
			async addModule(url) {
				registrations += 1;
				assert.ok(url.startsWith("data:text/javascript;base64,"));
				source = new TextDecoder("utf-8", { fatal: true }).decode(
					Buffer.from(url.slice(url.indexOf(",") + 1), "base64"),
				);
				runInContext(source, context, { timeout: 1000 });
			},
		},
	};
	await graph.ensureAudioFxWorklets(host);
	await graph.ensureAudioFxWorklets(host);
	assert.equal(registrations, 1);
	assert.equal(graph.audioFxWorkletsReady(host), true);
	assert.deepEqual([...registry.keys()].sort(), [
		"hf-bitcrush",
		"hf-compressor",
		"hf-gate",
		"hf-limiter",
		"hf-pitchshift",
	]);
	return {
		sourceSha256: sha256(source),
		render(name, params, channels, quantum = 128) {
			assert.ok(registry.has(name));
			assert.ok(channels.length > 0 && channels.length <= 2);
			const frames = channels[0].length;
			assert.ok(frames > 0 && frames <= 48000);
			assert.ok(quantum > 0 && quantum <= 128);
			assert.ok(channels.every((channel) => channel.length === frames));
			context.Processor = registry.get(name);
			context.options = { processorOptions: params };
			runInContext("globalThis.processor = new Processor(options)", context, {
				timeout: 1000,
			});
			const result = channels.map(() => new Float32Array(frames));
			for (let offset = 0; offset < frames; offset += quantum) {
				context.inputs = [
					channels.map((channel) => channel.subarray(offset, offset + quantum)),
				];
				const outputs = channels.map(
					() => new Float32Array(Math.min(quantum, frames - offset)),
				);
				context.outputs = [outputs];
				assert.equal(
					runInContext("processor.process(inputs, outputs)", context, {
						timeout: 1000,
					}),
					true,
				);
				outputs.forEach((channel, index) => result[index].set(channel, offset));
			}
			runInContext(
				"processor.port.onmessage({ data: { __hfDispose: true } })",
				context,
				{ timeout: 1000 },
			);
			assert.equal(
				runInContext("processor.process(inputs, outputs)", context, {
					timeout: 1000,
				}),
				false,
			);
			return result;
		},
	};
}

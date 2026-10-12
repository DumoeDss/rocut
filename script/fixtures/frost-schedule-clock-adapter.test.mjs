import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { installFrostScheduleClockAdapter } from "./frost-schedule-clock-adapter.mjs";
import { FIXED_PARAMS, FROST_SCHEDULE_VERSION, TICKS } from "./frost-schedule-fixture.mjs";

const contract = mode => ({ version: FROST_SCHEDULE_VERSION, params: FIXED_PARAMS, mode, frozenTicks: 0 });
function realm(mode, setup = "") {
	const context = vm.createContext({ TextDecoder, TextEncoder });
	vm.runInContext(`${setup}\nconst intrinsic = JSON.stringify;
		const adapter = (${installFrostScheduleClockAdapter.toString()})(${JSON.stringify(contract(mode))});`, context);
	return context;
}
const dto = ticks => ({ effectType: "frost", params: { ...FIXED_PARAMS }, localTime: ticks,
	frameRate: { numerator: 30, denominator: 1 } });

test("isolated negative serializer freezes only fixed Frost DTO and finally restores original", () => {
	const context = realm("freeze");
	context.inputs = TICKS.map(dto);
	context.mappedFrames = TICKS.map(ticks => ({ ticks, time: ticks / 120000 }));
	const frameSnapshot = JSON.stringify(context.mappedFrames), inputSnapshot = JSON.stringify(context.inputs);
	const outputs = vm.runInContext("inputs.map(input => JSON.stringify(input))", context);
	assert(outputs.every(text => JSON.parse(text).localTime === 0));
	assert.equal(JSON.stringify(context.inputs), inputSnapshot);
	assert.equal(JSON.stringify(context.mappedFrames), frameSnapshot);
	const state = vm.runInContext("adapter.state", context);
	assert.equal(state.serializations.length, 13);
	assert(state.serializations.every(record => record.dtoRestored && record.mutatedOnlyLocalTime));
	assert.deepEqual(Array.from(state.serializations, record => record.originalTicks), TICKS);
	vm.runInContext("adapter.restore()", context);
	assert.equal(vm.runInContext("JSON.stringify === intrinsic", context), true);
	assert.equal(vm.runInContext("adapter.state.restored", context), true);
});

test("advance observer and non-target serialization preserve native intrinsic semantics", () => {
	const context = realm("advance");
	context.inputs = [dto(16000), { ...dto(16000), effectType: "bubble" },
		{ ...dto(16000), params: { ...FIXED_PARAMS, seed: 18 } },
		{ ...dto(16000), extra: true }, { ...dto(16000), localTime: 48001 },
		{ ...dto(16000), frameRate: { numerator: 24, denominator: 1 } },
		{ hello: "world" }, [1, null, "value"]];
	const outputs = vm.runInContext("inputs.map(input => JSON.stringify(input))", context);
	assert.deepEqual(Array.from(outputs), context.inputs.map(input => JSON.stringify(input)));
	assert.equal(vm.runInContext("adapter.state.serializations.length", context), 1);
	assert.equal(vm.runInContext("adapter.state.serializations[0].serializedTicks", context), 16000);
	vm.runInContext("adapter.restore()", context);
});

test("target serialization exception still restores DTO and static function", () => {
	const context = realm("freeze", `const realStringify = JSON.stringify;
		JSON.stringify = function (input, ...args) {
			if (input?.effectType === 'frost' && input.localTime === 0) throw Error('test serialization failure');
			return Reflect.apply(realStringify, JSON, [input, ...args]);
		};`);
	context.input = dto(16000);
	assert.throws(() => vm.runInContext("JSON.stringify(input)", context), /test serialization failure/);
	assert.equal(context.input.localTime, 16000);
	assert.equal(vm.runInContext("adapter.state.serializations[0].dtoRestored", context), true);
	vm.runInContext("adapter.restore()", context);
	assert.equal(vm.runInContext("JSON.stringify === intrinsic", context), true);
});

test("fake raw ABI observes forwarded bytes without memory writes or substituted return passes", async () => {
	const context = realm("freeze", `const memory = new WebAssembly.Memory({ initial: 1 });
		const bytes = new Uint8Array(memory.buffer);
		const originalCalls = [];
		const raw = { memory, resolveStylizedEffectJson(ptr, length) {
			const text = new TextDecoder().decode(bytes.subarray(ptr, ptr + length));
			originalCalls.push(text);
			const input = JSON.parse(text);
			const output = new TextEncoder().encode(JSON.stringify({ frameIndex: input.localTime / 4000,
				passes: [{ shader: 'frost', uniforms: { testSentinel: 123 } }] }));
			bytes.set(output, 8192);
			return [8192, output.length];
		} };
		WebAssembly.instantiate = async () => ({ module: {}, instance: { exports: raw } });`);
	context.input = dto(16000);
	await vm.runInContext(`(async () => {
		const result = await WebAssembly.instantiate(new Uint8Array());
		const inputBytes = new TextEncoder().encode(JSON.stringify(input));
		bytes.set(inputBytes, 0);
		const returned = result.instance.exports.resolveStylizedEffectJson(0, inputBytes.length);
		if (returned[0] !== 8192) throw Error('return substitution');
		if (inputBytes.some((byte, index) => bytes[index] !== byte)) throw Error('input memory mutated');
	})()`, context);
	const state = vm.runInContext("adapter.state", context);
	assert.equal(state.wasmCalls.length, 1);
	assert.equal(state.wasmCalls[0].request.localTime, 0);
	assert.equal(state.wasmCalls[0].response.frameIndex, 0);
	assert.equal(state.wasmCalls[0].response.passes[0].uniforms.testSentinel, 123);
	assert.equal(context.input.localTime, 16000);
	vm.runInContext("adapter.restore()", context);
});

test("adapter rejects altered fixed contract before installing anything", () => {
	assert.throws(() => installFrostScheduleClockAdapter({ ...contract("freeze"), params: { ...FIXED_PARAMS, seed: 18 } }), /exact fixed fixture/);
});

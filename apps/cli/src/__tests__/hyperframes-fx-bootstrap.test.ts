import { expect, test } from "bun:test";
import { createContext, runInContext } from "node:vm";
import { HYPERFRAMES_FX_BOOTSTRAP } from "../programmatic/hyperframes-fx-bootstrap";

/** IO protocol unit tests only; the real browser suite exercises native DSP. */
function harness(
	options: { gain?: number; tail?: number; nonfinite?: boolean } = {},
) {
	const allocations: number[] = [];
	const context = createContext({
		isSecureContext: true,
		OfflineAudioContext: class {
			constructor(_channels: number, frames: number) {
				allocations.push(frames);
			}
		},
		atob: (text: string) => Buffer.from(text, "base64").toString("binary"),
		btoa: (text: string) => Buffer.from(text, "binary").toString("base64"),
	});
	runInContext("window = globalThis", context);
	runInContext(HYPERFRAMES_FX_BOOTSTRAP, context);
	runInContext(
		`window.__HF_AUDIO_FX = { render: async (input, rate) => {
		const frames = input[0].length + ${options.tail ?? 0};
		new OfflineAudioContext(2, frames, rate);
		return input.map(channel => {
			const out = new Float32Array(frames);
			for (let i = 0; i < channel.length; i++) out[i] = channel[i] * ${options.gain ?? 1};
			${options.nonfinite ? "out[0] = NaN;" : ""}
			return out;
		});
	} };`,
		context,
	);
	return {
		allocations,
		evaluate: (expression: string): any => runInContext(expression, context),
	};
}

const plan = (inputFrames = 9, expectedOutputFrames = inputFrames) => ({
	sampleRate: 48000,
	inputFrames,
	expectedOutputFrames,
	maxOutputBytes: expectedOutputFrames * 8,
});
function pcm(frames = 9) {
	const bytes = Buffer.alloc(frames * 8);
	for (let frame = 0; frame < frames; frame++) {
		bytes.writeFloatLE(frame / 4, frame * 8);
		bytes.writeFloatLE(-frame / 8, frame * 8 + 4);
	}
	return bytes;
}

test("private FX IO preserves stereo float PCM above unity without clamp or mastering", async () => {
	const io = harness({ gain: 2 }),
		input = pcm();
	io.evaluate(`rocutNativeFxIO.configure(${JSON.stringify(plan())})`);
	io.evaluate(
		`rocutNativeFxIO.put(0,${JSON.stringify(input.subarray(0, 64).toString("base64"))})`,
	);
	io.evaluate(
		`rocutNativeFxIO.put(64,${JSON.stringify(input.subarray(64).toString("base64"))})`,
	);
	expect(await io.evaluate("rocutNativeFxIO.render('{}', undefined)")).toEqual({
		frames: 9,
		bytes: 72,
		channels: 2,
	});
	const output = Buffer.concat(
		[0, 64].map((offset) =>
			Buffer.from(
				io.evaluate(
					`rocutNativeFxIO.read(${offset},${Math.min(64, 72 - offset)})`,
				),
				"base64",
			),
		),
	);
	for (let byte = 0; byte < input.length; byte += 4)
		expect(output.readFloatLE(byte)).toBe(input.readFloatLE(byte) * 2);
	expect(io.allocations).toEqual([9]);
	io.evaluate("rocutNativeFxIO.dispose()");
	expect(() => io.evaluate("rocutNativeFxIO.read(0,8)")).toThrow(
		"output chunk",
	);
});

test("native context output geometry is checked before allocation", async () => {
	const io = harness({ tail: 1 }),
		input = pcm(1);
	io.evaluate(`rocutNativeFxIO.configure(${JSON.stringify(plan(1))})`);
	io.evaluate(
		`rocutNativeFxIO.put(0,${JSON.stringify(input.toString("base64"))})`,
	);
	await expect(
		io.evaluate("rocutNativeFxIO.render('{}', undefined)"),
	).rejects.toThrow("admitted output geometry");
	expect(io.allocations).toEqual([]);
});

test("incomplete, oversized and out-of-order uploads fail closed", async () => {
	for (const statement of [
		"rocutNativeFxIO.put(8,'AAAAAAAAAAA=')",
		"rocutNativeFxIO.put(0,'AAAAAAAAAAAAAAAAAAAAAA==')",
	]) {
		const io = harness();
		io.evaluate(`rocutNativeFxIO.configure(${JSON.stringify(plan(1))})`);
		expect(() => io.evaluate(statement)).toThrow();
	}
	const io = harness();
	io.evaluate(`rocutNativeFxIO.configure(${JSON.stringify(plan(1))})`);
	await expect(
		io.evaluate("rocutNativeFxIO.render('{}',undefined)"),
	).rejects.toThrow("Incomplete");
});

test("nonfinite input and native output never cross the PCM boundary", async () => {
	const io = harness(),
		input = pcm(1);
	input.writeFloatLE(Number.POSITIVE_INFINITY, 0);
	io.evaluate(`rocutNativeFxIO.configure(${JSON.stringify(plan(1))})`);
	io.evaluate(
		`rocutNativeFxIO.put(0,${JSON.stringify(input.toString("base64"))})`,
	);
	await expect(
		io.evaluate("rocutNativeFxIO.render('{}',undefined)"),
	).rejects.toThrow("Nonfinite native FX input");
	expect(io.allocations).toEqual([]);
	const badOutput = harness({ nonfinite: true });
	badOutput.evaluate(`rocutNativeFxIO.configure(${JSON.stringify(plan(1))})`);
	badOutput.evaluate(
		`rocutNativeFxIO.put(0,${JSON.stringify(pcm(1).toString("base64"))})`,
	);
	await badOutput.evaluate("rocutNativeFxIO.render('{}',undefined)");
	expect(() => badOutput.evaluate("rocutNativeFxIO.read(0,8)")).toThrow(
		"Nonfinite native FX output",
	);
});

test("invalid admitted geometry is rejected without allocating a native context", () => {
	for (const invalid of [
		{ ...plan(), inputFrames: -1 },
		{ ...plan(), expectedOutputFrames: 1.5 },
		{ ...plan(), maxOutputBytes: 8 },
	]) {
		const io = harness();
		expect(() =>
			io.evaluate(`rocutNativeFxIO.configure(${JSON.stringify(invalid)})`),
		).toThrow("IO geometry");
		expect(io.allocations).toEqual([]);
	}
});

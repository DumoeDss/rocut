import { describe, expect, test } from "bun:test";
import {
	chainJson,
	definitions,
	equivalent,
	nativeAndRustReject,
	nativeParse,
} from "./hyperframes-fx-normalization-oracle";
import "./hyperframes-fx-normalization-policy";
import "./hyperframes-fx-normalization-numbers";
import "./hyperframes-fx-normalization-metadata";

describe("HyperFrames 0.8.139 pinned native FX normalization differential", () => {
	test("the pinned registry is exactly the supported sixteen effects", () => {
		expect(definitions.map((effect) => effect.id)).toStrictEqual([
			"gain",
			"peaking",
			"lowshelf",
			"highshelf",
			"highpass",
			"lowpass",
			"compressor",
			"limiter",
			"gate",
			"saturate",
			"bitcrush",
			"pitchshift",
			"delay",
			"chorus",
			"phaser",
			"reverb",
		]);
		equivalent(chainJson([]));
		equivalent(chainJson(definitions.map((effect) => ({ type: effect.id }))));
	});
	for (const effect of definitions) {
		test(`${effect.id}: defaults, every numeric range, enum option and wrong-value fallback`, () => {
			for (const params of [
				undefined,
				null,
				false,
				true,
				12,
				"params",
				[],
				[12],
				{},
			])
				equivalent(chainJson([{ type: effect.id, params }]));
			for (const parameter of effect.params) {
				const values =
					parameter.kind === "number"
						? [
								parameter.min - 1000,
								parameter.min,
								parameter.default,
								(parameter.min + parameter.max) / 2,
								parameter.max,
								parameter.max + 1000,
								-1e100,
								1e100,
								-0,
								0.123456789,
								null,
								false,
								true,
								[],
								[12],
								["12"],
								{},
								{ value: 12 },
							]
						: [
								...parameter.options.map((option) => option.value),
								"",
								"UNKNOWN",
								" 2 ",
								1,
								2,
								null,
								false,
								true,
								[],
								{},
							];
				for (const value of values)
					equivalent(
						chainJson([
							{
								type: effect.id,
								params: { [parameter.key]: value, ignored: "not forwarded" },
							},
						]),
					);
			}
		});
	}
	test("serial static tails, disabled nodes and wet/mix zero match native tail module", () => {
		for (const feedback of [0.01, 0.1, 0.2, 0.25, 0.5, 0.75, 0.9, 0.95])
			for (const time of [1, 125, 1000, 5000])
				equivalent(chainJson([{ type: "delay", params: { feedback, time } }]));
		for (const type of ["delay", "chorus", "pitchshift", "reverb"]) {
			for (const enabled of [true, false])
				for (const amount of [0, 0.001, 0.5, 1])
					equivalent(
						chainJson([
							{ type, enabled, params: { mix: amount, wet: amount } },
						]),
					);
		}
		for (const nodes of [
			[
				{ type: "delay", params: { time: 1, feedback: 0.01 } },
				{ type: "reverb", params: { size: 0.2 } },
			],
			[
				{ type: "delay", params: { time: 5000, feedback: 0.95 } },
				{ type: "reverb", params: { size: 1 } },
			],
			[
				{ type: "pitchshift", params: { semitones: 0, mix: 1 } },
				{ type: "chorus", params: { delay: 100 } },
			],
		])
			equivalent(chainJson(nodes));
	});
	test("invalid JSON, envelopes and nodes reject rather than silently normalize away", () => {
		for (const input of [
			"",
			"{",
			"null",
			"false",
			"1",
			'"chain"',
			"[]",
			"{}",
			'{"version":"1","nodes":[]}',
			'{"version":2,"nodes":[]}',
			'{"version":1}',
			'{"version":1,"nodes":{}}',
			chainJson([null]),
			chainJson([false]),
			chainJson([1]),
			chainJson([[]]),
		])
			nativeAndRustReject(input);
		const permissive =
			'{"version":1,"ignored":{"note":"native extension"},"nodes":[{"type":"gain","params":{"gain":"-3"},"extra":true}]}';
		equivalent(permissive);
		expect(nativeParse(permissive).nodes).toHaveLength(1);
	});
});

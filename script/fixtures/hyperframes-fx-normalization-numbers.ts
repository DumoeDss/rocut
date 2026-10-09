import { describe, test } from "bun:test";
import {
	chainJson,
	definitions,
	equivalent,
	nativeAndRustReject,
} from "./hyperframes-fx-normalization-oracle";

describe("HyperFrames pinned JavaScript numeric coercion", () => {
	test("numeric strings retain Number semantics, radix forms, JS whitespace and invalid-string fallback", () => {
		const strings = [
			"12.5",
			"+12.5",
			"-12.5",
			".125",
			"12.",
			"1e-2",
			"-2.5E+1",
			"1e309",
			"-0",
			"0x10",
			"0XfF",
			"0b101",
			"0B11",
			"0o17",
			"0O10",
			"00012",
			" 12 ",
			"",
			" ",
			"NaN",
			"Infinity",
			"-Infinity",
			"1px",
			"1_000",
			"0x",
			"+0x10",
			"-0x10",
			"0b2",
			"0o8",
			"1e",
			"1.2.3",
			"0x1p2",
			"\u180e12",
			"12\u0085",
			"12\u200b",
		];
		const whitespace = [
			"\t",
			"\n",
			"\v",
			"\f",
			"\r",
			" ",
			"\u00a0",
			"\u1680",
			"\u2000",
			"\u2001",
			"\u2002",
			"\u2003",
			"\u2004",
			"\u2005",
			"\u2006",
			"\u2007",
			"\u2008",
			"\u2009",
			"\u200a",
			"\u2028",
			"\u2029",
			"\u202f",
			"\u205f",
			"\u3000",
			"\ufeff",
		];
		for (const space of whitespace)
			strings.push(`${space}0.375${space}`, `${space}${space}`);
		strings.push(
			"0".repeat(200) + "1",
			"0x" + "0".repeat(200) + "f",
			"0b" + "0".repeat(200) + "1",
			"0o" + "0".repeat(200) + "7",
			"0x" + "f".repeat(200),
			"0b" + "1".repeat(200),
			"0o" + "7".repeat(200),
			"0x" + "f".repeat(2000),
		);
		for (const effect of definitions)
			for (const parameter of effect.params)
				if (parameter.kind === "number")
					for (const value of strings)
						equivalent(
							chainJson([
								{ type: effect.id, params: { [parameter.key]: value } },
							]),
						);
	});
	test("raw JSON overflow preserves native fallback without repairing malformed numeric tokens", () => {
		for (const token of [
			"1e999",
			"-1e999",
			"1e-999",
			"-1e-999",
			"1e308",
			"-0",
		]) {
			equivalent(
				`{"version":1,"nodes":[{"type":"compressor","params":{"threshold":${token}},"presetAmount":${token}}]}`,
			);
			equivalent(
				`{"version":1,"nodes":[{"type":"compressor","params":{"threshold":"${token}"},"presetAmount":"${token}"}]}`,
			);
		}
		for (const token of [
			"1e",
			"1e+",
			"01",
			"-01",
			"+1",
			".1",
			"1.",
			"0x10",
			"NaN",
			"Infinity",
			"-Infinity",
			"1e999x",
		])
			nativeAndRustReject(
				`{"version":1,"nodes":[{"type":"gain","params":{"gain":${token}}}]}`,
			);
		nativeAndRustReject('{"version":1e999,"nodes":[]}');
	});
});

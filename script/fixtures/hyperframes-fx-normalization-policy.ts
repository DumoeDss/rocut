import { describe, expect, test } from "bun:test";
import {
	chainJson,
	equivalent,
	policyRejects,
} from "./hyperframes-fx-normalization-oracle";

describe("Rocut-only FX input admission policy (not native normalization parity)", () => {
	test("isolated UTF-16 surrogates are refused instead of silently replaced with U+FFFD", () => {
		for (const escaped of [
			"\\ud800",
			"\\udfff",
			"\\ud800x",
			"x\\udfff",
			"\\udfff\\ud800",
		])
			for (const input of [
				`{"version":1,"nodes":[{"type":"gain","label":"${escaped}"}]}`,
				`{"version":1,"nodes":[],"ignored":"${escaped}"}`,
				`{"version":1,"nodes":[],"${escaped}":0}`,
			])
				policyRejects(input);
	});
	test("128 KiB is an inclusive UTF-8 input boundary", () => {
		const valid = chainJson([]),
			atLimit = valid + " ".repeat(128 * 1024 - Buffer.byteLength(valid));
		expect(Buffer.byteLength(atLimit)).toBe(128 * 1024);
		equivalent(atLimit);
		policyRejects(atLimit + " ");
	});
	test("32 nodes are admitted; 33 native-valid nodes are refused", () => {
		equivalent(chainJson(Array.from({ length: 32 }, () => ({ type: "gain" }))));
		policyRejects(
			chainJson(Array.from({ length: 33 }, () => ({ type: "gain" }))),
		);
	});
	test("each metadata string is limited to 256 UTF-8 bytes, not characters", () => {
		for (const key of ["id", "fromPreset", "label", "fromEq"])
			for (const value of ["x".repeat(256), "界".repeat(85) + "x"]) {
				expect(Buffer.byteLength(value)).toBe(256);
				equivalent(chainJson([{ type: "gain", [key]: value }]));
				policyRejects(chainJson([{ type: "gain", [key]: value + "x" }]));
			}
		// Unknown metadata is dropped by native parsing, but uses the generic
		// string limit rather than inheriting a recognized metadata field's cap.
		equivalent(chainJson([{ type: "gain", unknownMetadata: "x".repeat(257) }]));
	});
	test("all JSON string values and object keys obey 4096 UTF-8 bytes", () => {
		for (const value of ["x".repeat(4096), "界".repeat(1365) + "x"]) {
			expect(Buffer.byteLength(value)).toBe(4096);
			equivalent(JSON.stringify({ version: 1, nodes: [], extra: value }));
			policyRejects(
				JSON.stringify({ version: 1, nodes: [], extra: value + "x" }),
			);
			equivalent(JSON.stringify({ version: 1, nodes: [], [value]: 0 }));
			policyRejects(
				JSON.stringify({ version: 1, nodes: [], [value + "x"]: 0 }),
			);
		}
		equivalent(
			chainJson([{ type: "gain", params: { gain: "0".repeat(4095) + "1" } }]),
		);
		policyRejects(
			chainJson([{ type: "gain", params: { gain: "0".repeat(4096) + "1" } }]),
		);
	});
	test("depth eight includes the root at depth zero", () => {
		const nested = (leafDepth: number): unknown => {
			let value: unknown = 0;
			for (let i = 1; i < leafDepth; i++) value = [value];
			return value;
		};
		equivalent(JSON.stringify({ version: 1, nodes: [], extra: nested(8) }));
		policyRejects(JSON.stringify({ version: 1, nodes: [], extra: nested(9) }));
	});
	test("64 unique keys per object are allowed, including dropped params", () => {
		const fields = (count: number) =>
			Object.fromEntries(
				Array.from({ length: count }, (_, index) => [`unknown${index}`, 0]),
			);
		equivalent(JSON.stringify({ version: 1, nodes: [], ...fields(62) }));
		policyRejects(JSON.stringify({ version: 1, nodes: [], ...fields(63) }));
		equivalent(
			chainJson([{ type: "gain", params: { gain: -3, ...fields(63) } }]),
		);
		policyRejects(
			chainJson([{ type: "gain", params: { gain: -3, ...fields(64) } }]),
		);
		// Parsing uses JSON.parse-compatible last-key-wins semantics. Repeated
		// lexical keys are not additional object entries after decoding.
		const repeated = Array.from(
			{ length: 80 },
			(_, index) => `"gain":${index}`,
		).join(",");
		equivalent(
			`{"version":1,"nodes":[{"type":"gain","params":{${repeated}}}]}`,
		);
	});
	test("4096 values count every container and primitive but not object keys", () => {
		// Root, version, nodes array, extra array = four values before entries.
		equivalent(
			JSON.stringify({ version: 1, nodes: [], extra: Array(4092).fill(0) }),
		);
		policyRejects(
			JSON.stringify({ version: 1, nodes: [], extra: Array(4093).fill(0) }),
		);
	});
});

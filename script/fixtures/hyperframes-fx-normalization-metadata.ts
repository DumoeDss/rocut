import { describe, expect, test } from "bun:test";
import {
	chainJson,
	equivalent,
	nativeAndRustReject,
	rustResult,
} from "./hyperframes-fx-normalization-oracle";

describe("HyperFrames pinned metadata and enable semantics", () => {
	test("paired Unicode surrogate escapes retain native metadata and unknown-key semantics", () => {
		equivalent(
			'{"version":1,"nodes":[{"type":"gain","id":"\\ud83c\\udfb5","label":"voice \\ud83d\\ude00"}],"\\ud83d\\ude00":"\\ud83c\\udfb5"}',
		);
		equivalent(chainJson([{ type: "gain", label: "🎵".repeat(64) }]));
	});
	test("enabled is false only for the strict boolean; disabled unknown effects are still rejected", () => {
		for (const enabled of [
			undefined,
			false,
			true,
			null,
			0,
			1,
			"false",
			"",
			[],
			{},
		])
			for (const type of ["gain", "delay", "reverb"])
				equivalent(chainJson([{ type, enabled }]));
		for (const type of ["unknown", "Gain", "", null, 1, [], {}])
			nativeAndRustReject(chainJson([{ type, enabled: false }]));
	});
	test("optional metadata, strict true flags, presetAmount and duplicate IDs retain exact native structure", () => {
		for (const value of [
			undefined,
			"",
			" ",
			"voice",
			"台詞 🎵",
			null,
			false,
			true,
			0,
			0.25,
			1,
			[],
			{},
		]) {
			equivalent(
				chainJson([
					{
						type: "compressor",
						id: value,
						label: value,
						fromPreset: value,
						fromEq: value,
						fromCarve: value,
						fromLeveller: value,
						presetAmount: value,
						unknownMetadata: "dropped",
					},
				]),
			);
		}
		for (const presetAmount of [
			-100,
			-0,
			0,
			0.375,
			1,
			100,
			"0.5",
			"1",
			"Infinity",
			null,
			false,
			[],
			{},
		])
			equivalent(chainJson([{ type: "reverb", presetAmount }]));
		const duplicates = chainJson([
			{ type: "delay", id: "same" },
			{ type: "gain", id: "same", enabled: false },
		]);
		equivalent(duplicates);
		expect(
			(rustResult(duplicates).chain as { nodes: unknown[] }).nodes,
		).toHaveLength(2);
	});
});

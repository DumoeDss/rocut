import { expect, spyOn, test } from "bun:test";
import { revisionOf } from "@opencut/editor-contracts";
import { projectOpenCutDraft, publicDocumentsEqual } from "../projection";
import { motionTextSequenceFixture, projectFixture } from "./fixture";

// Preserve the previous serializer as an independent compatibility oracle.
function legacyValue(value: unknown): string {
	if (value === null) return "null";
	if (value === undefined) return "undefined";
	if (typeof value === "string") return `string:${JSON.stringify(value)}`;
	if (typeof value === "number" || typeof value === "boolean")
		return `${typeof value}:${String(value)}`;
	if (Array.isArray(value))
		return `array:[${value.map(legacyValue).join(",")}]`;
	if (typeof value === "object")
		return `object:{${Object.keys(value)
			.sort()
			.map(
				(key) =>
					`${JSON.stringify(key)}:${legacyValue(Reflect.get(value, key))}`,
			)
			.join(",")}}`;
	return `${typeof value}:${String(value)}`;
}

function documentFixture() {
	const project = projectFixture();
	project.motionTextSequences.push(motionTextSequenceFixture());
	return projectOpenCutDraft(
		{ project, assetCatalog: [] },
		{ revision: revisionOf(0), idempotency: [] },
	);
}

test("ordinary projection comparison avoids materializing canonical strings", () => {
	const left = documentFixture();
	const right = structuredClone(left);
	const stringify = spyOn(JSON, "stringify");
	let equal, calls;
	try {
		equal = publicDocumentsEqual(left, right);
		calls = stringify.mock.calls.length;
	} finally {
		stringify.mockRestore();
	}
	expect(equal).toBe(true);
	expect(calls).toBe(0);
	Reflect.set(
		right.motionTextSequences?.[0].cues[0] ?? {},
		"text",
		"different cue",
	);
	expect(publicDocumentsEqual(left, right)).toBe(false);
});

test("comparison preserves legacy acyclic data semantics including sparse arrays", () => {
	const hidden = Object.defineProperty({ b: 1 }, "a", {
		value: 1,
		enumerable: false,
	});
	const sparse = new Array(2);
	sparse[1] = 1;
	const values: unknown[] = [
		undefined,
		null,
		false,
		true,
		0,
		-0,
		NaN,
		Infinity,
		-Infinity,
		1,
		1n,
		"",
		"1",
		"undefined",
		"中文",
		[],
		new Array(1),
		new Array(2),
		sparse,
		[undefined],
		[undefined, 1],
		[null],
		[1, 2],
		[2, 1],
		{},
		{ a: undefined },
		{ a: null },
		{ a: 1 },
		{ b: 1 },
		hidden,
		{ a: 1, b: 2 },
		{ b: 2, a: 1 },
		Object.assign(Object.create(null), { a: 1 }),
		new Date(0),
		new Map([["ignored", 1]]),
		new Set([1]),
		new Uint8Array([1, 2]),
		{ nested: [{ b: 2, a: 1 }] },
		{ nested: [{ a: 1, b: 2 }] },
	];
	const base = documentFixture();
	const documents = values.map((value) => {
		const project = { ...base.project };
		Reflect.set(project, "comparisonFixture", value);
		return { ...base, project };
	});
	for (let a = 0; a < values.length; a++)
		for (let b = 0; b < values.length; b++) {
			expect(publicDocumentsEqual(documents[a], documents[b])).toBe(
				legacyValue(values[a]) === legacyValue(values[b]),
			);
		}
});

test("document equality ignores envelope metadata and entity order, not cue order or missing fields", () => {
	const left = documentFixture();
	const right = structuredClone(left);
	Reflect.set(right, "revision", revisionOf(9));
	Reflect.set(right, "idempotency", [{ key: "ignored-envelope" }]);
	Reflect.set(left, "markers", [
		{ id: "a", time: 0 },
		{ id: "b", time: 1 },
	]);
	Reflect.set(right, "markers", [
		{ id: "b", time: 1 },
		{ id: "a", time: 0 },
	]);
	expect(publicDocumentsEqual(left, right)).toBe(true);
	Reflect.set(right.project, "missingVersusUndefined", undefined);
	expect(publicDocumentsEqual(left, right)).toBe(false);
	Reflect.deleteProperty(right.project, "missingVersusUndefined");
	const a = left.motionTextSequences?.[0];
	const b = right.motionTextSequences?.[0];
	if (!a || !b) throw new Error("missing fixture sequence");
	const cues = [a.cues[0], { ...a.cues[0], id: "second", text: "Second" }];
	Reflect.set(a, "cues", cues);
	Reflect.set(b, "cues", [...cues].reverse());
	expect(publicDocumentsEqual(left, right)).toBe(false);
});

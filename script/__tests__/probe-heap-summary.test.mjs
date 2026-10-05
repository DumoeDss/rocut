import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeHeap, captureHeapSummary } from "../probe-heap-summary.mjs";

function fixture() {
	const strings = [],
		names = new Map();
	const sid = (s) => {
		if (!names.has(s)) {
			names.set(s, strings.length);
			strings.push(s);
		}
		return names.get(s);
	};
	const nt = ["synthetic", "object", "string", "closure", "array", "code"],
		et = ["property", "element", "weak", "internal"];
	const specs = [
		[
			"synthetic",
			"root",
			0,
			[
				["ledger", 1],
				["sensitive-root-token", 8, "weak"],
				["code", 10],
			],
		],
		[
			"object",
			"SecretConstructorDoNotPrint",
			24,
			[
				["acquired", 2],
				["history", 6],
			],
		],
		["object", "Set", 24, [[0, 3, "element"]]],
		[
			"object",
			"Object",
			48,
			[
				["resourceClass", 4],
				["resourceId", 5],
				["release", 9],
			],
		],
		["string", "timer", 16, []],
		["string", "http://private/?token=secret-auth-token", 64, []],
		["array", "Array", 24, [[0, 7, "element"]]],
		[
			"object",
			"Object",
			32,
			[
				["resourceClass", 4],
				["resourceId", 5],
			],
		],
		[
			"object",
			"Object",
			48,
			[
				["resourceClass", 4],
				["resourceId", 5],
				["release", 9],
			],
		],
		["closure", "secret-auth-token", 40, []],
		["code", "private source code", 4096, []],
	];
	const nodes = [],
		edges = [];
	for (let i = 0; i < specs.length; i++) {
		const [type, name, size, children] = specs[i];
		nodes.push(nt.indexOf(type), sid(name), i + 1, size, children.length);
		for (const [name, target, type = "property"] of children)
			edges.push(
				et.indexOf(type),
				type === "element" ? name : sid(name),
				target * 5,
			);
	}
	return {
		snapshot: {
			meta: {
				node_fields: ["type", "name", "id", "self_size", "edge_count"],
				node_types: [nt],
				edge_fields: ["type", "name_or_index", "to_node"],
				edge_types: [et],
			},
		},
		nodes,
		edges,
		strings,
	};
}

test("summarizes types and class sizes while distinguishing history from tracked entries", () => {
	const result = summarizeHeap(fixture());
	assert.equal(result.nodeCount, 11);
	assert.equal(result.types.code.selfBytes, 4096);
	assert.equal(result.classes.Object.count, 3);
	assert.deepEqual(result.resources.timer, {
		referenceRecords: 1,
		trackedRecords: 2,
	});
});

test("strong paths exclude weak-only records and retain useful safe ownership edges", () => {
	const result = summarizeHeap(fixture());
	const tracked = result.retainerExamples.filter(
		(x) => x.kind === "trackedRecords",
	);
	assert.equal(tracked.filter((x) => x.stronglyReachable).length, 1);
	assert(
		tracked
			.find((x) => x.stronglyReachable)
			.path.some((x) => x.edge === "acquired"),
	);
	assert.deepEqual(tracked.find((x) => !x.stronglyReachable).path, []);
});

test("never serializes arbitrary names, source code, property names, URLs or secrets", () => {
	const output = JSON.stringify(summarizeHeap(fixture()));
	for (const sensitive of [
		"secret-auth-token",
		"SecretConstructorDoNotPrint",
		"private source code",
		"sensitive-root-token",
		"http://",
	])
		assert(!output.includes(sensitive));
});

test("invalid heap schema is rejected", () => {
	const snapshot = fixture();
	snapshot.snapshot.meta.node_fields[0] = "wrong";
	assert.throws(() => summarizeHeap(snapshot), /unsupported heap schema/);
});

test("large string retention reports sizes and paths but never content", () => {
	const snapshot = fixture();
	snapshot.nodes[5 * 5 + 3] = 1_000_000;
	const result = summarizeHeap(snapshot);
	const large = result.retainerExamples.find(
		(entry) => entry.kind === "large-string",
	);
	assert.equal(large.selfBytes, 1_000_000);
	assert.equal(large.stronglyReachable, true);
	assert(!JSON.stringify(result).includes("secret-auth-token"));
});

test("capture removes its listener both after summary and on CDP failure", async () => {
	const listeners = new Set();
	let fail = false;
	const cdp = {
		on(name, handler) {
			assert.equal(name, "HeapProfiler.addHeapSnapshotChunk");
			listeners.add(handler);
		},
		off(name, handler) {
			listeners.delete(handler);
		},
		async send(name) {
			assert.equal(name, "HeapProfiler.takeHeapSnapshot");
			if (fail) throw Error("diagnostic failed");
			const raw = JSON.stringify(fixture());
			for (const listener of listeners) {
				listener({ chunk: raw.slice(0, 50) });
				listener({ chunk: raw.slice(50) });
			}
		},
	};
	assert.equal((await captureHeapSummary(cdp)).types.code.selfBytes, 4096);
	assert.equal(listeners.size, 0);
	fail = true;
	await assert.rejects(captureHeapSummary(cdp), /diagnostic failed/);
	assert.equal(listeners.size, 0);
});

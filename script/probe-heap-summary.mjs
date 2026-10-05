import assert from "node:assert/strict";

const SAFE_TYPES = new Set([
	"hidden",
	"array",
	"string",
	"object",
	"code",
	"closure",
	"regexp",
	"number",
	"native",
	"synthetic",
	"concatenated string",
	"sliced string",
	"symbol",
	"bigint",
	"object shape",
]);
const SAFE_CLASSES = new Set([
	"Object",
	"Array",
	"Map",
	"Set",
	"WeakMap",
	"WeakSet",
	"Promise",
	"ArrayBuffer",
	"SharedArrayBuffer",
	"Uint8Array",
	"Uint8ClampedArray",
	"Uint32Array",
	"Int32Array",
	"Float64Array",
	"DataView",
	"OffscreenCanvas",
	"HTMLCanvasElement",
	"AudioContext",
	"VideoFrame",
	"FontFace",
]);
const RESOURCE_CLASSES = [
	"timer",
	"worker",
	"audioContext",
	"objectUrl",
	"gpuResource",
];
const SAFE_EDGES = new Set([
	"acquired",
	"history",
	"resources",
	"current",
	"memoizedState",
	"memoizedProps",
	"stateNode",
	"ref",
	"return",
	"child",
	"sibling",
	"alternate",
	"hooks",
	"deps",
	"next",
	"handler",
	"callback",
	"release",
	"releasePromise",
	"session",
	"editor",
	"compositor",
	"renderer",
	"elements",
	"properties",
	"context",
	"ledger",
	"source",
	"text",
	"data",
	"body",
	"value",
	"buffer",
	"cachedFonts",
]);

// Never return raw strings, IDs, URLs, property values, or source text. A heap
// contains authentication material even when the project itself is synthetic.
export function summarizeHeap(snapshot) {
	const meta = snapshot.snapshot.meta,
		nodes = snapshot.nodes,
		edges = snapshot.edges,
		strings = snapshot.strings;
	const nf = meta.node_fields,
		ef = meta.edge_fields;
	const at = Object.fromEntries(
		["type", "name", "self_size", "edge_count"].map((key) => [
			key,
			nf.indexOf(key),
		]),
	);
	const ea = Object.fromEntries(
		["type", "name_or_index", "to_node"].map((key) => [key, ef.indexOf(key)]),
	);
	assert(
		Object.values(at).every((i) => i >= 0) &&
			Object.values(ea).every((i) => i >= 0),
		"unsupported heap schema",
	);
	assert.equal(nodes.length % nf.length, 0);
	assert.equal(edges.length % ef.length, 0);
	const count = nodes.length / nf.length,
		nodeTypes = meta.node_types[at.type],
		edgeTypes = meta.edge_types[ea.type];
	const offsets = new Uint32Array(count + 1),
		totals = {},
		classes = {},
		resources = Object.fromEntries(
			RESOURCE_CLASSES.map((key) => [
				key,
				{ referenceRecords: 0, trackedRecords: 0 },
			]),
		);
	const examples = [];
	const largeStrings = [];
	let edgeOffset = 0;
	const typeOf = (offset) => nodeTypes[nodes[offset + at.type]];
	const nameOf = (offset) => strings[nodes[offset + at.name]];
	const safeNode = (offset) => {
		const type = typeOf(offset),
			name = nameOf(offset);
		return SAFE_CLASSES.has(name)
			? name
			: SAFE_TYPES.has(type)
				? type
				: "other";
	};
	for (let n = 0; n < count; n++) {
		const off = n * nf.length,
			type = typeOf(off),
			name = nameOf(off),
			size = nodes[off + at.self_size];
		const group = SAFE_TYPES.has(type) ? type : "other";
		if (type === "string" && size >= 65536)
			largeStrings.push({ node: n, kind: "large-string", selfBytes: size });
		const entry = (totals[group] ??= { count: 0, selfBytes: 0 });
		entry.count++;
		entry.selfBytes += size;
		if (type === "object" && SAFE_CLASSES.has(name)) {
			const row = (classes[name] ??= { count: 0, selfBytes: 0 });
			row.count++;
			row.selfBytes += size;
		}
		offsets[n] = edgeOffset;
		let resourceClass,
			hasId = false,
			tracked = false;
		const end = edgeOffset + nodes[off + at.edge_count] * ef.length;
		assert(end <= edges.length, "invalid heap edge span");
		for (let e = edgeOffset; e < end; e += ef.length) {
			if (edgeTypes[edges[e + ea.type]] !== "property") continue;
			const prop = strings[edges[e + ea.name_or_index]],
				target = edges[e + ea.to_node];
			if (
				prop === "resourceClass" &&
				typeOf(target) === "string" &&
				RESOURCE_CLASSES.includes(nameOf(target))
			)
				resourceClass = nameOf(target);
			if (prop === "resourceId") hasId = true;
			if (
				prop === "release" ||
				prop === "releaseStarted" ||
				prop === "releasePromise"
			)
				tracked = true;
		}
		if (resourceClass && hasId) {
			const kind = tracked ? "trackedRecords" : "referenceRecords";
			resources[resourceClass][kind]++;
			if (
				examples.filter(
					(x) => x.resourceClass === resourceClass && x.kind === kind,
				).length < 2
			)
				examples.push({ node: n, resourceClass, kind });
		}
		edgeOffset = end;
	}
	offsets[count] = edgeOffset;
	assert.equal(edgeOffset, edges.length);
	examples.push(
		...largeStrings.sort((a, b) => b.selfBytes - a.selfBytes).slice(0, 8),
	);
	// Strong shortest root paths explain retention without exporting a raw heap.
	const parent = new Int32Array(count).fill(-1),
		via = new Int32Array(count).fill(-1),
		queue = new Uint32Array(count);
	parent[0] = 0;
	queue[0] = 0;
	let head = 0,
		tail = 1;
	while (head < tail) {
		const n = queue[head++];
		for (let e = offsets[n]; e < offsets[n + 1]; e += ef.length) {
			if (edgeTypes[edges[e + ea.type]] === "weak") continue;
			const target = edges[e + ea.to_node] / nf.length;
			assert(
				Number.isInteger(target) && target >= 0 && target < count,
				"invalid heap node reference",
			);
			if (parent[target] !== -1) continue;
			parent[target] = n;
			via[target] = e;
			queue[tail++] = target;
		}
	}
	const paths = examples.map(({ node, ...label }) => {
		const path = [];
		for (
			let n = node;
			n !== 0 && parent[n] !== -1 && path.length < 40;
			n = parent[n]
		) {
			const e = via[n],
				type = edgeTypes[edges[e + ea.type]],
				name = strings[edges[e + ea.name_or_index]];
			const edge =
				type === "property" || type === "context" || type === "internal"
					? SAFE_EDGES.has(name)
						? name
						: type
					: type === "element"
						? "element"
						: "other";
			path.push({ edge, node: safeNode(n * nf.length) });
		}
		return {
			...label,
			stronglyReachable: parent[node] !== -1,
			path: path.reverse(),
		};
	});
	return {
		nodeCount: count,
		edgeCount: edges.length / ef.length,
		types: totals,
		classes,
		resources,
		retainerExamples: paths,
	};
}

export async function captureHeapSummary(cdp) {
	let chunks = [];
	const collect = ({ chunk }) => chunks.push(chunk);
	cdp.on("HeapProfiler.addHeapSnapshotChunk", collect);
	try {
		await cdp.send("HeapProfiler.takeHeapSnapshot", {
			reportProgress: false,
			captureNumericValue: false,
		});
		const snapshot = JSON.parse(chunks.join(""));
		chunks = [];
		return summarizeHeap(snapshot);
	} finally {
		cdp.off("HeapProfiler.addHeapSnapshotChunk", collect);
		chunks = [];
	}
}

import { channel, key, sampleItem, request, wireJson, constantDifference } from "./animation-scalar-reference.mjs";

export function sampleCases() {
	const cases = [];
	const add = (name, items) => cases.push({ name, api: "sample", input: wireJson(request(items)), expected: { kind: "samples" } });
	add("empty-batch", []);
	add("fallback-bit-patterns", [0, -0, Number.MIN_VALUE, -Number.MIN_VALUE, 2 ** -1022,
		0.10000000000000002, Number.MAX_VALUE, -Number.MAX_VALUE].map((fallbackValue, index) =>
		sampleItem(`bits-${index}`, [], [-Number.MAX_VALUE, -1.25, -0, 0.5, Number.MAX_VALUE], { fallbackValue })));
	const items = [];
	for (const segment of ["step", "linear", "bezier"]) for (const before of ["hold", "linear"]) {
		for (const start of [0, Number.MAX_SAFE_INTEGER - 20]) {
			const keys = [key(start, .2, segment, { rightHandle: { dt: 50, dv: .7 } }),
				key(start + 20, .8, "linear", { leftHandle: { dt: -50, dv: -.4 } })];
			const times = [-2.5, 0, .25, 1.5, 9.25, 19.75, 20, 21.5].map(time => start + time);
			items.push(sampleItem(`${segment}-${before}-${start}`, keys, times, { channel: channel(keys, before, "linear") }));
		}
	}
	add("segments-signed-fractional-large-ticks", items);
	add("piecewise-default-handles-and-reverse-requests", [
		sampleItem("mixed", [key(0, -.25, "step"), key(3, .75, "linear"), key(20, -1, "bezier"), key(57, 2)],
			[57.25, 57, 56.875, 40.125, 20.25, 20, 12.125, 3, 2.999, 0, -1]),
		sampleItem("single", [key(10, -0, "bezier")], [-Number.MAX_VALUE, -Number.MIN_VALUE, 10, 10.5, Number.MAX_VALUE]),
		sampleItem("subnormal", [key(0, Number.MIN_VALUE), key(10, Number.MIN_VALUE * 9)], [0, .125, 2.5, 5, 9.875, 10]),
	]);
	const difference = constantDifference();
	add("explicit-v1-constant-rule", [{ ...difference.item, times: [difference.time] }]);
	add("exact-item-and-request-sample-limits", Array.from({ length: 16 }, (_, index) =>
		sampleItem(`samples-${index}`, [], Array(4096).fill(.25), { fallbackValue: -Number.MAX_VALUE })));
	const keys = Array.from({ length: 8192 }, (_, index) => key(index, index % 3 / 2, "step"));
	add("exact-item-and-request-key-limits", Array.from({ length: 4 }, (_, index) => sampleItem(`keys-${index}`, keys, [0, 2.5, 8191])));
	add("exact-item-count", Array.from({ length: 128 }, (_, index) => sampleItem(`item-${index}`, [], [])));
	add("decoded-utf8-id-limit", [sampleItem("\u754c".repeat(85) + "a", [], [])]);
	return cases;
}

export function errorCases() {
	const cases = [];
	const add = (name, input, expected, api = "sample") => cases.push({ name, api,
		input: typeof input === "string" ? input : wireJson(input), expected });
	const requestError = code => ({ kind: "request-error", code });
	const itemError = (code, more = {}) => ({ status: "error", code, ...more });
	for (const [name, input, code] of [
		["empty-input", " ", "empty-input"], ["malformed-json", "{", "invalid-json"],
		["duplicate-root", '{"version":1,"version":1}', "duplicate-field"],
		["trailing-json", "{} {}", "invalid-json"],
		["nonfinite-json", '{"version":1e309}', "invalid-json"],
		["decimal-version", '{"version":1.0,"numericSemantics":"scalar-f64-v1","items":[]}', "unsupported-version"],
		["input-limit", " ".repeat(8 * 1024 * 1024 + 1), "input-bytes"],
		["depth-limit", "[".repeat(17) + "0" + "]".repeat(17), "json-depth"],
		["node-limit", "[" + "0,".repeat(1_000_000) + "0]", "json-nodes"],
	]) add(name, input, requestError(code));
	add("unsupported-semantics", { ...request([]), numericSemantics: "next" }, requestError("unsupported-semantics"));
	add("duplicate-id", request([sampleItem("same"), sampleItem("same")]), requestError("duplicate-id"));
	add("unknown-root", { ...request([]), extra: true }, requestError("unknown-field"));
	add("decoded-string-limit", request([sampleItem("\u754c".repeat(86))]), requestError("string-bytes"));
	add("item-count-limit", request(Array.from({ length: 129 }, (_, i) => sampleItem(String(i), [], []))), requestError("item-count"));
	add("request-sample-limit", request(Array.from({ length: 17 }, (_, i) => sampleItem(String(i), [], Array(4096).fill(0)))), requestError("request-sample-count"));
	add("request-key-limit", request(Array.from({ length: 5 }, (_, i) => sampleItem(String(i), Array(8192).fill(key(0, 0)), []))), requestError("request-key-count"));
	const overflow = sampleItem("overflow", [key(0, -Number.MAX_VALUE), key(10, Number.MAX_VALUE)], [0, 5, 10]);
	add("item-atomic-overflow-and-isolation", request([overflow, sampleItem("next")]), {
		kind: "mixed", items: [itemError("non-finite-arithmetic", { sampleIndex: 1, keyIndex: 0 }), { status: "values" }],
	});
	add("bezier-control-overflow-is-atomic", request([sampleItem("curve-overflow", [
		key(0, Number.MAX_VALUE, "bezier", { rightHandle: { dt: 3, dv: Number.MAX_VALUE } }), key(10, 0),
	], [0, 5, 10]), sampleItem("next")]), {
		kind: "mixed", items: [itemError("non-finite-arithmetic", { sampleIndex: 1, keyIndex: 0 }), { status: "values" }],
	});
	const edgeKeys = [key(0, 0), key(10, Number.MAX_VALUE)];
	add("linear-extrapolation-overflow-is-atomic", request([sampleItem("edge-overflow", edgeKeys, [10, 20],
		{ channel: channel(edgeKeys, "linear", "linear") }), sampleItem("next")]), {
		kind: "mixed", items: [itemError("non-finite-arithmetic", { sampleIndex: 1, keyIndex: 1 }), { status: "values" }],
	});
	add("item-malformed-time-atomic", request([sampleItem("bad-time", [], [0, null, 1]), sampleItem("next")]), {
		kind: "mixed", items: [itemError("finite-number", { sampleIndex: 1 }), { status: "values" }],
	});
	for (const [name, item, code] of [
		["unordered", sampleItem("bad", [key(2, 0), key(1, 1)]), "unordered-keys"],
		["unknown-key", sampleItem("bad", [key(0, 1, "linear", { tangentMode: "flat" })]), "unknown-field"],
		["handle-sign", sampleItem("bad", [key(0, 1, "bezier", { rightHandle: { dt: -1, dv: 0 } })]), "invalid-handle"],
		["item-keys", sampleItem("bad", Array(8193).fill(key(0, 0)), []), "item-key-count"],
		["item-samples", sampleItem("bad", [], Array(4097).fill(0)), "item-sample-count"],
		["null-fallback", sampleItem("bad", [], [0], { fallbackValue: null }), "finite-number"],
	]) add(name, request([item, sampleItem("good")]), { kind: "mixed", items: [itemError(code), { status: "values" }] });
	const canonical = wireJson(request([sampleItem("token", [key(10, 1)])]));
	for (const token of ["10.0", "1e1", "10.00000000000000001", "-1", "9007199254740992"])
		add(`key-token-${cases.length}`, canonical.replace('"time":10', `"time":${token}`), {
			kind: "mixed", items: [itemError("invalid-key-time", { keyIndex: 0 })],
		});
	return cases;
}

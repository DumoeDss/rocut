import { channel, key, request, wireJson } from "./animation-scalar-reference.mjs";

export const inspectItem = (id, keys = [], maxNodes = 16, options = {}) => ({
	id, channel: channel(keys), fallbackValue: .5, domain: { start: 0, end: 120000 },
	bounds: { min: 0, max: 1, displayMultiplier: 1 }, budget: { maxNodes }, ...options,
});
export const smoothKeys = () => [key(0, 0, "bezier", { rightHandle: { dt: 50400, dv: 0 } }),
	key(120000, 1, "linear", { leftHandle: { dt: -50400, dv: 0 } })];

export function inspectCases() {
	const cases = [];
	const add = (name, items, budget, expectedItems, visitedNodes) => cases.push({
		name, api: "inspect", input: wireJson(request(items, budget)),
		expected: { kind: "inspection", items: expectedItems, visitedNodes },
	});
	const safe = visitedNodes => ({ status: "safe", visitedNodes });
	const unresolved = (visitedNodes, code = "budget-exhausted") => ({ status: "unresolved", visitedNodes, code });
	const violation = code => ({ status: "violation", code, visitedNodes: 0 });
	add("inspect-empty", [], 0, [], 0);
	add("inspect-simple-safe-domains", [
		inspectItem("negative-multiplier", [key(0, 0), key(120000, 1)], 0,
			{ bounds: { min: -2, max: 0, displayMultiplier: -2 } }),
		inspectItem("signed-local-domain", [key(0, 0), key(10, 1)], 0, {
			channel: channel([key(0, 0), key(10, 1)], "linear", "hold"),
			domain: { start: -1.25, end: 2.5 }, bounds: { displayMultiplier: 1 },
		}),
		inspectItem("constant-curve", [key(0, 1, "bezier"), key(120000, 1)], 0),
		inspectItem("subnormal", [], 0, { fallbackValue: Number.MIN_VALUE, bounds: { min: 0, max: 1, displayMultiplier: 1 } }),
	], 1, [safe(0), safe(0), safe(0), safe(0)], 0);
	add("inspect-ordinary-smooth-single-node", [inspectItem("one", smoothKeys(), 1),
		inspectItem("many", smoothKeys(), 65536)], 262144, [safe(1), safe(1)], 2);
	const near = smoothKeys(); near[0].value = 1 - 2 ** -53;
	add("inspect-near-boundary-unresolved", [inspectItem("near", near, 4096)], 8192, [unresolved(4096)], 4096);
	add("inspect-three-states", [inspectItem("safe", [], 0),
		inspectItem("violation", [key(0, 1.5)], 0), inspectItem("unresolved", smoothKeys(), 0)],
		1, [safe(0), violation("outside-bounds"), unresolved(0)], 0);
	add("inspect-overflow-witnesses", [
		inspectItem("arithmetic", [key(0, -Number.MAX_VALUE), key(120000, Number.MAX_VALUE)], 0,
			{ bounds: { displayMultiplier: 1 } }),
		inspectItem("display", [], 0, { fallbackValue: Number.MAX_VALUE, bounds: { displayMultiplier: 2 } }),
	], 1, [violation("non-finite-arithmetic"), violation("non-finite-arithmetic")], 0);
	const multi = count => Array.from({ length: count }, (_, i) => key(i * 12000, i % 2 ? .75 : .25, "bezier"));
	add("inspect-request-actual-budget", [inspectItem("zero-cost", [], 10),
		inspectItem("consume", multi(10), 65536), inspectItem("unstarted", [], 65536)],
		8, [safe(0), unresolved(8, "request-budget-exhausted"), unresolved(0, "request-budget-exhausted")], 8);
	add("inspect-item-budget-across-segments", [inspectItem("long", multi(32), 20,
		{ domain: { start: 0, end: 31 * 12000 } })], 100, [unresolved(20)], 20);
	add("inspect-zero-request-still-validates", [inspectItem("valid", [], 0),
		inspectItem("domain", [], 1, { domain: { start: 2, end: 1 } }),
		inspectItem("bounds", [], 1, { bounds: { min: 2, max: 1, displayMultiplier: 1 } }),
		inspectItem("budget", [], 65537), inspectItem("keys", [key(2, 0), key(1, 1)], 1)], 0,
		[unresolved(0, "request-budget-exhausted"), ...["invalid-domain", "invalid-bounds", "invalid-budget", "unordered-keys"]
			.map(code => ({ status: "error", code }))], 0);
	add("inspect-invalid-item-consumes-no-budget", [inspectItem("bad", smoothKeys(), 65536,
		{ bounds: { min: 0, max: -1, displayMultiplier: 1 } }), inspectItem("good", smoothKeys(), 16)],
		16, [{ status: "error", code: "invalid-bounds" }, safe(1)], 1);
	add("inspect-independent-next-request", [inspectItem("good", smoothKeys(), 16)], 16, [safe(1)], 1);
	const addError = (name, input, code) => cases.push({ name, api: "inspect", input: typeof input === "string" ? input : wireJson(input),
		expected: { kind: "request-error", code } });
	addError("inspect-budget-required", request([]), "missing-field");
	addError("inspect-budget-ceiling", request([], 262145), "invalid-budget");
	addError("inspect-budget-integer-token", wireJson(request([], 1)).replace('"maxNodes":1', '"maxNodes":1.0'), "invalid-budget");
	return cases;
}

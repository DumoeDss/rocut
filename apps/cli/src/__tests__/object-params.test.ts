import { expect, test } from "bun:test";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import {
	getProgrammaticObjectParamsCapability,
	OBJECT_PARAMS_MAX_BYTES,
	ObjectParamsUnavailableError,
	resolveProgrammaticObjectParams,
} from "../programmatic/object-params";
import { handleProgrammaticObjectParamsRoute } from "../programmatic/object-params-route";

const success = '{"version":1,"ok":true,"params":{"version":1,"rustDefault":42}}';
const failure = '{"version":1,"ok":false,"error":{"code":"range","path":"amount","message":"Rust rejection"}}';

test("transport forwards params only and preserves either Rust envelope without defaults", () => {
	const calls: string[] = [];
	const exports = { resolveLiquidObjectParamsJson: (json: string) => { calls.push(json); return success; } };
	expect(resolveProgrammaticObjectParams({ object: "liquid", params: { version: 1, arbitrary: 2 } }, exports)).toBe(success);
	expect(calls).toEqual(['{"version":1,"arbitrary":2}']);
	expect(resolveProgrammaticObjectParams({ object: "ink", params: { version: 2 } }, { resolveInkObjectParamsJson: () => failure })).toBe(failure);
});

test("invalid JSON transport, budgets, missing exports, traps and malformed envelopes fail closed", () => {
	for (const input of [null, {}, { object: "other", params: {} }, { object: "liquid", params: [], extra: true },
		{ object: "liquid", params: { value: NaN } }, { object: "liquid", params: { value: undefined } },
		{ object: "liquid", params: { value: "x".repeat(OBJECT_PARAMS_MAX_BYTES) } }])
		expect(() => resolveProgrammaticObjectParams(input, {})).toThrow();
	const cycle: Record<string, unknown> = {}; cycle.self = cycle;
	expect(() => resolveProgrammaticObjectParams({ object: "liquid", params: cycle }, {})).toThrow("budget");
	const input = { object: "glass", params: { version: 1 } };
	expect(() => resolveProgrammaticObjectParams(input, {})).toThrow(ObjectParamsUnavailableError);
	for (const resolver of [() => { throw Error("trap"); }, () => "{}", () => "not-json", () => ({ version: 1 })])
		expect(() => resolveProgrammaticObjectParams(input, { resolveGlassObjectParamsJson: resolver })).toThrow(ObjectParamsUnavailableError);
	expect(getProgrammaticObjectParamsCapability({ resolveLiquidObjectParamsJson: () => success, resolveGlassObjectParamsJson: () => failure }).resolvers.map(value => value.available)).toEqual([true, false, false]);
});

test("HTTP route enforces JSON media type, strict UTF8 and byte budget, returns Rust failure as 200", async () => {
	let calls = 0;
	const server = createServer((request, response) => void handleProgrammaticObjectParamsRoute(request, response, {
		resolveLiquidObjectParamsJson: () => { calls++; return failure; },
	}));
	await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw Error("No server address");
	const url = `http://127.0.0.1:${address.port}`;
	try {
		const result = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: '{"object":"liquid","params":{"version":1}}' });
		expect(result.status).toBe(200); expect(await result.text()).toBe(failure); expect(result.headers.get("cache-control")).toBe("no-store");
		for (const body of ["{", new Uint8Array([0xff]), " ".repeat(OBJECT_PARAMS_MAX_BYTES + 1)]) {
			const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body });
			expect(response.status).toBe(400); await response.text();
		}
		const wrongType = await fetch(url, { method: "POST", body: "{}" });
		expect(wrongType.status).toBe(400); await wrongType.text();
		const unavailable = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: '{"object":"glass","params":{"version":1}}' });
		expect(unavailable.status).toBe(503); await unavailable.text();
		expect(calls).toBe(1);
	} finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("selected real Rust package resolves all three defaults and rejects unknown params", async () => {
	const directory = process.env.ROCUT_TEST_OBJECT_PARAMS_WASM_PACKAGE_DIR;
	if (!directory) return;
	const exports = await import(pathToFileURL(`${directory}/opencut_wasm_sync.js`).href);
	expect(getProgrammaticObjectParamsCapability(exports).resolvers.map(value => value.available)).toEqual([true, true, true]);
	for (const object of ["liquid", "glass", "ink"]) {
		const result = JSON.parse(resolveProgrammaticObjectParams({ object, params: { version: 1 } }, exports));
		expect(result.ok).toBe(true); expect(result.params.version).toBe(1);
		const invalid = JSON.parse(resolveProgrammaticObjectParams({ object, params: { version: 1, notARustField: true } }, exports));
		expect(invalid.ok).toBe(false); expect(typeof invalid.error.message).toBe("string");
	}
});

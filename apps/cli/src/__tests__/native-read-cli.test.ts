import { expect, test } from "bun:test";
import { runNativeReadCli } from "../native-read-cli";
import type { request } from "../host-request";

const resolved = { secret: { port: 12345, token: "fixture-only" } };
const bytes = (value: unknown) =>
	new TextEncoder().encode(JSON.stringify(value));
test("record uses the existing authenticated read endpoint and preserves its response", async () => {
	const calls: unknown[][] = [];
	const result = {
		record: { data: { opaque: true } },
		summary: { id: "native" },
	};
	const invoke: typeof request = async (...args) => {
		calls.push(args);
		return result;
	};
	expect(
		await runNativeReadCli("record", [], resolved, { request: invoke }),
	).toEqual(result);
	expect(calls).toEqual([[resolved.secret, "GET", "record"]]);
});
test("apply-status sends the exact original batch to observation only", async () => {
	const batch = {
		expectedRevision: 3,
		idempotencyKey: "original",
		operations: [
			{
				kind: "update-clip",
				clipId: "clip",
				patch: { opaque: { nested: true } },
			},
		],
	};
	const calls: unknown[][] = [];
	const invoke: typeof request = async (...args) => {
		calls.push(args);
		return { status: "unknown" };
	};
	expect(
		await runNativeReadCli("apply-status", ["original.json"], resolved, {
			request: invoke,
			readSpec: async () => bytes(batch),
		}),
	).toEqual({ status: "unknown" });
	expect(calls).toEqual([[resolved.secret, "POST", "apply-status", batch]]);
});
test("invalid status identity or operations never reach a native endpoint", async () => {
	let called = false;
	const invoke: typeof request = async () => {
		called = true;
		return {};
	};
	for (const batch of [
		{ expectedRevision: 0, operations: [] },
		{ expectedRevision: -1, idempotencyKey: "key", operations: [] },
		{ expectedRevision: 0, idempotencyKey: "key", operations: [null] },
		{
			expectedRevision: 0,
			idempotencyKey: "key",
			operations: [],
			route: "apply",
		},
	]) {
		await expect(
			runNativeReadCli("apply-status", ["original.json"], resolved, {
				request: invoke,
				readSpec: async () => bytes(batch),
			}),
		).rejects.toThrow();
	}
	expect(called).toBe(false);
});
test("status JSON is strict UTF-8 and record accepts no mutation arguments", async () => {
	await expect(
		runNativeReadCli("apply-status", ["original.json"], resolved, {
			readSpec: async () => new Uint8Array([0xff]),
		}),
	).rejects.toThrow();
	await expect(
		runNativeReadCli("record", ["mutation.json"], resolved),
	).rejects.toThrow("usage");
});

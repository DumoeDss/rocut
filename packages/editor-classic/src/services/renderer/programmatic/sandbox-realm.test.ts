import { afterEach, expect, test } from "bun:test";
import { ProgrammaticSandboxRealm } from "./sandbox-realm";
import { installSandboxHarness } from "./sandbox-runtime-test-fixture";

let harness: ReturnType<typeof installSandboxHarness>;
afterEach(() => harness?.restore());

test("broker ownership refuses simultaneous leases and a different document", () => {
	harness = installSandboxHarness();
	const realm = new ProgrammaticSandboxRealm(new AbortController().signal);
	const first = realm.acquire("trusted document");
	expect(() => realm.acquire("trusted document")).toThrow("unavailable");
	first.release(true);
	first.release(false);
	expect(realm.isClosed).toBe(false);
	expect(() => realm.acquire("different document")).toThrow("document changed");
	const next = realm.acquire("trusted document");
	expect(next.iframe).toBe(first.iframe);
	expect(next.loaded).toBe(true);
	next.release(false);
	expect(harness.removeCalls).toBe(1);
	expect(() => realm.acquire("trusted document")).toThrow("unavailable");
});

test("pre-aborted lifecycle never allocates a broker and close is idempotent", () => {
	harness = installSandboxHarness();
	const lifetime = new AbortController();
	lifetime.abort(Error("suspended"));
	const realm = new ProgrammaticSandboxRealm(lifetime.signal);
	expect(() => realm.acquire("trusted document")).toThrow("suspended");
	realm.close();
	expect(harness.removeCalls).toBe(0);
});

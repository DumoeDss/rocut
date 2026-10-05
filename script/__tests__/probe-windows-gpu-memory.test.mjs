import assert from "node:assert/strict";
import { test } from "node:test";
import { validateGpuMemorySample } from "../probe-windows-gpu-memory.mjs";

const identity = { gpuPid: 42, mainPid: 21, created: "2026-10-06T00:00:00Z" };
const fixture = () => ({
	pid: 42,
	parentPid: 21,
	isGpu: true,
	created: identity.created,
	rows: [
		{ name: "pid_42_luid_1_phys_0", dedicated: 100, shared: 40, committed: 30 },
		{ name: "pid_42_luid_2_phys_0", dedicated: 5, shared: 8, committed: 2 },
	],
});

test("GPU totals preserve separate resident and committed metrics", () => {
	const input = fixture();
	const before = structuredClone(input);
	assert.deepEqual(validateGpuMemorySample(input, identity).totals, {
		dedicated: 105,
		shared: 48,
		committed: 32,
	});
	assert.deepEqual(input, before);
});

for (const [label, mutate] of [
	["another process", (v) => v.pid++],
	["another host", (v) => v.parentPid++],
	["non-GPU process", (v) => (v.isGpu = false)],
	["PID reuse", (v) => (v.created = "later")],
	["missing counters", (v) => (v.rows = [])],
	["foreign counter", (v) => (v.rows[0].name = "pid_41_luid_1_phys_0")],
	["duplicate counter", (v) => v.rows.push(v.rows[0])],
	["negative bytes", (v) => (v.rows[0].shared = -1)],
	["unsafe bytes", (v) => (v.rows[0].dedicated = Number.MAX_SAFE_INTEGER + 1)],
	["string bytes", (v) => (v.rows[0].committed = "30")],
])
	test(`GPU samples reject ${label}`, () => {
		const input = fixture();
		mutate(input);
		assert.throws(() => validateGpuMemorySample(input, identity));
	});

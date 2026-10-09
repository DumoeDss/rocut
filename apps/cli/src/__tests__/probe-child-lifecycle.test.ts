import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { runProbeChild } from "../../../../script/probe-child-lifecycle.mjs";

const settings = {
	executable: process.execPath,
	cwd: "C:/tmps/rocut-stylized-f6XU4z",
	timeoutMs: 3000,
	closeTimeoutMs: 2000,
};
const rejected = async (promise: Promise<unknown>) => {
	const error = await promise.then(
		() => undefined,
		(error) => error,
	);
	expect(error?.name).toBe("ProbeChildLifecycleError");
	return error.lifecycle;
};

test("private real child forwards stdout/stderr and confirms successful close", async () => {
	const chunks: Buffer[] = [];
	const lifecycle = await runProbeChild({
		...settings,
		args: [
			"-e",
			"process.stdout.write('ready'); process.stderr.write('checked');",
		],
		onOutput: (bytes: Buffer) => chunks.push(bytes),
	});
	expect(lifecycle.status).toBe("passed");
	expect(lifecycle.closed).toBe(true);
	expect(lifecycle.killAttempted).toBe(false);
	expect(lifecycle.exitCode).toBe(0);
	expect(Buffer.concat(chunks).toString()).toContain("ready");
	expect(Buffer.concat(chunks).toString()).toContain("checked");
});

test("private real child timeout waits for direct close and remains failed", async () => {
	let forwarded = 0;
	const lifecycle = await rejected(
		runProbeChild({
			...settings,
			timeoutMs: 300,
			args: ["-e", "setInterval(() => process.stdout.write('.'), 10);"],
			onOutput: () => forwarded++,
		}),
	);
	expect(lifecycle.status).toBe("failed");
	expect(lifecycle.timedOut).toBe(true);
	expect(lifecycle.killAttempted).toBe(true);
	expect(lifecycle.closed).toBe(true);
	expect(lifecycle.closeTimedOut).toBe(false);
	const before = forwarded;
	await new Promise((resolve) => setTimeout(resolve, 25));
	expect(forwarded).toBe(before);
});

test("missing executable error clears runtime deadline and confirms close", async () => {
	const lifecycle = await rejected(
		runProbeChild({
			...settings,
			executable: "C:/tmps/rocut-stylized-f6XU4z/nonexistent-probe-runtime.exe",
			args: [],
		}),
	);
	expect(lifecycle.spawned).toBe(false);
	expect(lifecycle.closed).toBe(true);
	expect(lifecycle.timedOut).toBe(false);
	expect(lifecycle.closeTimedOut).toBe(false);
	expect(lifecycle.killAttempted).toBe(false);
});

test("real child nonzero exit cannot be certified as success", async () => {
	const lifecycle = await rejected(
		runProbeChild({
			...settings,
			args: ["-e", "process.exitCode = 7;"],
		}),
	);
	expect(lifecycle.closed).toBe(true);
	expect(lifecycle.exitCode).toBe(7);
	expect(lifecycle.status).toBe("failed");
});

test("unconfirmed close is explicit and late output cannot touch ended logs", async () => {
	const child = Object.assign(new EventEmitter(), {
		pid: 4242,
		stdout: new PassThrough(),
		stderr: new PassThrough(),
		kill: () => true,
	});
	let forwarded = 0;
	const lifecycle = await rejected(
		runProbeChild(
			{
				...settings,
				args: [],
				timeoutMs: 10,
				closeTimeoutMs: 10,
				onOutput: () => forwarded++,
			},
			() => child,
		),
	);
	expect(lifecycle.closed).toBe(false);
	expect(lifecycle.closeTimedOut).toBe(true);
	expect(lifecycle.killAttempted).toBe(true);
	expect(lifecycle.status).toBe("failed");
	child.stdout.emit("data", Buffer.from("late"));
	child.stderr.emit("data", Buffer.from("late"));
	child.emit("close", 0, null);
	expect(forwarded).toBe(0);
	expect(lifecycle.closed).toBe(false);
	expect(Object.isFrozen(lifecycle)).toBe(true);
});

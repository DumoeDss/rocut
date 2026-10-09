import { spawn } from "node:child_process";

export class ProbeChildLifecycleError extends Error {
	constructor(lifecycle) {
		super(lifecycle.errors.join("; ") || "Private probe child failed");
		this.name = "ProbeChildLifecycleError";
		this.lifecycle = lifecycle;
	}
}

/**
 * Wait for the direct harness's close event, including after kill/error. This
 * does not claim that killing a harness terminates its descendants. If the
 * bounded close grace expires, report uncertainty and stop forwarding output.
 * The optional spawn seam is for isolated lifecycle tests only.
 */
export function runProbeChild(options, spawnChild = spawn) {
	const { executable, args, cwd, env, onOutput } = options;
	const timeoutMs = options.timeoutMs ?? 240_000;
	const closeTimeoutMs = options.closeTimeoutMs ?? 5000;
	for (const value of [timeoutMs, closeTimeoutMs])
		if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647)
			throw Error(
				"Probe child deadlines must be positive bounded milliseconds",
			);
	return new Promise((resolve, reject) => {
		const state = {
			status: "running",
			spawned: false,
			closed: false,
			timedOut: false,
			closeTimedOut: false,
			killAttempted: false,
			exitCode: null,
			exitSignal: null,
			errors: [],
			closureScope: "direct harness only; descendant shutdown is not inferred",
		};
		let child,
			timer,
			closeTimer,
			settled = false;
		const streams = [];
		const finish = () => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			clearTimeout(closeTimer);
			for (const stream of streams) {
				stream.removeListener("data", output);
				// An unconfirmed late child may still write; drain without touching
				// the caller's now-closed log or certifying subsequent closure.
				stream.resume();
			}
			state.status =
				state.closed && state.exitCode === 0 && !state.errors.length
					? "passed"
					: "failed";
			const lifecycle = Object.freeze({
				...state,
				errors: Object.freeze([...state.errors]),
			});
			if (lifecycle.status === "passed") resolve(lifecycle);
			else reject(new ProbeChildLifecycleError(lifecycle));
		};
		const waitForClose = () => {
			if (settled || closeTimer) return;
			clearTimeout(timer);
			closeTimer = setTimeout(() => {
				state.closeTimedOut = true;
				state.errors.push(
					"Direct probe harness close was not confirmed before the cleanup deadline",
				);
				finish();
			}, closeTimeoutMs);
		};
		const stop = () => {
			if (settled || state.closed) return;
			waitForClose();
			if (!state.killAttempted && child?.pid) {
				state.killAttempted = true;
				try {
					state.killReturned = child.kill();
				} catch (error) {
					state.errors.push(`Direct harness kill failed: ${String(error)}`);
				}
			}
		};
		const output = (bytes) => {
			if (settled) return;
			try {
				onOutput?.(bytes);
			} catch (error) {
				state.errors.push(`Probe output forwarding failed: ${String(error)}`);
				stop();
			}
		};
		try {
			child = spawnChild(executable, args, {
				cwd,
				env,
				windowsHide: true,
				stdio: ["ignore", "pipe", "pipe"],
			});
		} catch (error) {
			state.errors.push(`Probe harness spawn failed: ${String(error)}`);
			finish();
			return;
		}
		if (child.pid) {
			state.pid = child.pid;
			state.spawned = true;
		}
		for (const stream of [child.stdout, child.stderr])
			if (stream) {
				streams.push(stream);
				stream.on("data", output);
			}
		child.on("error", (error) => {
			if (settled) return;
			state.errors.push(`Probe harness process error: ${String(error)}`);
			stop();
		});
		child.once("close", (code, signal) => {
			if (settled) return;
			state.closed = true;
			state.exitCode = code;
			state.exitSignal = signal;
			if (code !== 0 && !state.errors.length)
				state.errors.push(
					`Probe harness exited ${code}${signal ? ` (${signal})` : ""}`,
				);
			finish();
		});
		timer = setTimeout(() => {
			state.timedOut = true;
			state.errors.push("Private particle probe timed out");
			stop();
		}, timeoutMs);
	});
}

/**
 * `host ensure` (S08 R / B1) — the idempotent join verb. Given a project
 * directory: a live daemon for that exact project path is reused (its three
 * lines printed, nothing created); otherwise the daemon is started as a
 * DETACHED child that survives the caller's exit, the registry is polled
 * until the entry passes the routing predicate or the bounded wait fires,
 * then the same lines are printed and ensure exits. `host start`'s
 * foreground behavior is untouched — ensure is the verb for callers whose
 * command must return (external agents above all).
 *
 * Process model (design D1): spawn `process.execPath` with
 * `[process.argv[1], "host", "start", …]` — the same code path works for the
 * source CLI (`bun …/src/main.ts`) and the packed bundle (`bun rocut.mjs`).
 * Stdio is discarded by default (no new token-bearing log surface; the
 * secret file is the durable record); `--log <file>` opt-in, truncated on
 * open so repeated ensures never accumulate token-bearing output.
 */
import { spawn } from "node:child_process";
import { open, type FileHandle } from "node:fs/promises";
import path from "node:path";
import {
	normalizeProjectKey,
	PROBE_TIMEOUT_SLOW_MS,
	type TargetRegistry,
} from "./target-registry";

export const DEFAULT_ENSURE_TIMEOUT_MS = 15_000;
const REGISTRY_POLL_INTERVAL_MS = 250;

export interface EnsureArgs {
	readonly projectRoot: string;
	readonly registry: TargetRegistry;
	readonly staticDir?: string;
	readonly port?: number;
	/** Bounded registry wait; default 15 s. */
	readonly timeoutMs?: number;
	/** Opt-in token-bearing log for the spawned daemon, truncated on open. */
	readonly logFile?: string;
	/** Spawn overrides (tests point these at the real entry file). */
	readonly execPath?: string;
	readonly scriptPath?: string;
}

export interface EnsureResult {
	readonly state: "reused" | "started";
	readonly targetId: string;
	readonly editorUrl: string;
	readonly pid: number;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function result(
	state: "reused" | "started",
	target: { readonly entry: { readonly id: string; readonly pid: number }; readonly secret: { readonly port: number; readonly token: string } },
): EnsureResult {
	return {
		state,
		targetId: target.entry.id,
		editorUrl: `http://127.0.0.1:${target.secret.port}/${target.secret.token}/`,
		pid: target.entry.pid,
	};
}

export async function ensureHost(args: EnsureArgs): Promise<EnsureResult> {
	const resolvedProject = path.resolve(args.projectRoot);
	const timeoutMs = args.timeoutMs ?? DEFAULT_ENSURE_TIMEOUT_MS;
	const probe = { timeoutMs: PROBE_TIMEOUT_SLOW_MS };

	// Live path: a daemon for this exact project path already passes the
	// routing predicate — reuse it, create nothing.
	const live = await args.registry.resolveForProject(resolvedProject, probe);
	if (live !== null) return result("reused", live);

	// Fail closed on ambiguity for THIS project: a pid-alive entry whose
	// identity probe is inconclusive is neither routed to nor reaped, and a
	// second daemon must not be started against it.
	const projectKey = normalizeProjectKey(resolvedProject);
	const classified = await args.registry.classifyAll(probe);
	const forProject = classified.filter(
		({ entry }) => normalizeProjectKey(entry.projectPath) === projectKey,
	);
	const unverified = forProject.filter(
		({ classification }) => classification.verdict === "unverified",
	);
	if (unverified.length > 0) {
		const { entry } = unverified[0];
		throw new Error(
			`target ${entry.id} (pid ${entry.pid}) for this project is unverified — ` +
				"not routing to it, not reaping it, not starting a second daemon. " +
				"Confirm the process is yours and `rocut target reap --project <dir>` " +
				`it, or stop pid ${entry.pid} by hand, then retry.`,
		);
	}

	// Project-scoped reap: this project's positively-dead entries must not
	// block a fresh start (a stale same-id entry would otherwise be replaced
	// by register, but a stale same-PATH entry with a foreign id lingers).
	for (const { entry } of forProject.filter(
		({ classification }) => classification.verdict === "dead",
	)) {
		await args.registry.remove(entry.id);
	}

	// Re-check right before spawning: keeps the two-CLIs-race window tight
	// (documented residual risk in the design, not a lock).
	const rechecked = await args.registry.resolveForProject(
		resolvedProject,
		probe,
	);
	if (rechecked !== null) return result("reused", rechecked);

	const forwarded: string[] = ["--targets-root", args.registry.root];
	if (args.staticDir !== undefined) {
		forwarded.push("--static", args.staticDir);
	}
	if (args.port !== undefined) {
		forwarded.push("--port", String(args.port));
	}

	let logHandle: FileHandle | undefined;
	let stdio: "ignore" | ("ignore" | number)[];
	if (args.logFile !== undefined) {
		logHandle = await open(args.logFile, "w");
		stdio = ["ignore", logHandle.fd, logHandle.fd];
	} else {
		stdio = "ignore";
	}
	let spawnError: Error | undefined;
	let exitInfo: string | undefined;
	try {
		const child = spawn(
			args.execPath ?? process.execPath,
			[
				args.scriptPath ?? process.argv[1],
				"host",
				"start",
				resolvedProject,
				...forwarded,
			],
			{ detached: true, stdio, windowsHide: true },
		);
		const childPid = child.pid;
		child.once("error", (error) => {
			spawnError = error;
		});
		child.once("exit", (code, signal) => {
			exitInfo = `exited (code=${code} signal=${signal})`;
		});
		child.unref(); // the daemon outlives the ensure caller

		const deadline = Date.now() + timeoutMs;
		for (;;) {
			await sleep(REGISTRY_POLL_INTERVAL_MS);
			if (spawnError !== undefined) {
				throw new Error(
					`host ensure: the spawned daemon failed to start (${spawnError.message})`,
				);
			}
			const appeared = await args.registry.resolveForProject(
				resolvedProject,
				probe,
			);
			if (appeared !== null) return result("started", appeared);
			if (Date.now() >= deadline) {
				// Pointer, never content: name the log file when the caller
				// passed one; otherwise name how to get one (stdio was
				// discarded — the default keeps no token-bearing surface).
				const logPointer =
					args.logFile !== undefined
						? `; daemon log: ${args.logFile}`
						: "; no daemon log was captured (stdio discarded) — re-run with --log <file> to capture one";
				throw new Error(
					`host ensure timed out after ${timeoutMs} ms waiting for a live registry entry ` +
						`(child pid ${childPid ?? "?"}${exitInfo !== undefined ? ` ${exitInfo}` : ""})${logPointer}`,
				);
			}
		}
	} finally {
		await logHandle?.close().catch(() => undefined);
	}
}

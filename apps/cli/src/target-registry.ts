/**
 * The host target registry (S06 C3, director-precedent shape; S08 R adds the
 * host-supervisor contract, project-identity resolution and the hygiene
 * predicates).
 *
 * Two files with different trust levels:
 *
 * - `<root>/targets.json` — public metadata for `target list`: id, port,
 *   project, pid, startedAt, lastActivityAt. Never the token, never the URL.
 * - `<root>/targets/<id>.json` — the connection secret (port + token) a
 *   `--target` client reads to reconnect. Credential URLs are printed only on
 *   explicit `host start` / `host ensure` and never appear in any listing.
 *
 * The index is a cross-repo contract: the landed Elftia supervisor reads it
 * with a validating filter (`id`/`port`/`pid`/`projectPath`/numeric
 * `startedAt`), so `startedAt` MUST be written as epoch-ms — an ISO string is
 * filtered out as malformed, making every entry invisible to the host.
 * Legacy ISO-string entries (written before this contract fix) are read
 * tolerantly: never routable, reap-eligible once their pid is confirmed gone.
 */
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";

export interface TargetEntry {
	readonly id: string;
	readonly port: number;
	readonly pid: number;
	readonly projectPath: string;
	/** Epoch ms — the landed host supervisor's reader accepts only a number.
	 * For a legacy-converted entry this is the conversion moment, not the
	 * daemon's true start (unknown; see parseEntry). */
	readonly startedAt: number;
	/** Present only on entries read from a legacy (pre-contract) index. */
	readonly legacyStartedAt?: string;
	/** Additive idle signal the daemon patches in place (throttled). */
	readonly lastActivityAt?: number;
}

export interface TargetSecret {
	readonly id: string;
	readonly port: number;
	readonly token: string;
}

export interface ResolvedTarget {
	readonly entry: TargetEntry;
	readonly secret: TargetSecret;
}

/** The one daemon route outside the token-path prefix (bearer auth). */
export const HEALTH_PATH = "/health";

/** Probe budget for reap / ensure-start confirmation. */
export const PROBE_TIMEOUT_SLOW_MS = 2000;
/** Probe budget for per-verb routing (loopback; only bounds the squatter case). */
export const PROBE_TIMEOUT_FAST_MS = 500;

/**
 * A legitimate probe response is `{id}` — a few dozen bytes. This bounds how
 * much of a response `probeIdentity` will ever buffer before giving up, so a
 * process squatting a recycled port cannot stream an endless 200 response.
 */
const MAX_PROBE_RESPONSE_BYTES = 64 * 1024;

/** The moment the current OS boot started, in epoch ms (the host's formula). */
export function osBootTimeMs(): number {
	return Date.now() - os.uptime() * 1000;
}

/**
 * `process.kill(pid, 0)` sends no signal — it only tests whether a process
 * with this pid could be signaled. `ESRCH` ⇒ no such process ⇒ dead. Any
 * other error — `EPERM` above all, "a process exists but we may not signal
 * it" — means a process DOES hold that pid, so it counts as **alive**
 * (treating EPERM as dead is the classic bug the host supervisor's D4 calls
 * out; the old `alive()` here had exactly it).
 */
export function pidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		const err = error as NodeJS.ErrnoException & { errno?: unknown };
		// ESRCH ⇒ no such process ⇒ dead. bun ≤ 1.2.2 on Windows reports
		// code "" for every failure, with its private errno encoding
		// (-4040 no-such-process, -4048 exists-but-denied — node and newer
		// bun carry the same errnos alongside proper codes), so the errno is
		// accepted as the ESRCH signal there. Everything else — EPERM above
		// all, "a process exists but we may not signal it" — is alive.
		return err.code !== "ESRCH" && err.errno !== -4040;
	}
}

/**
 * GET `http://127.0.0.1:<port>/health` carrying the token as a bearer
 * `Authorization` header — the landed supervisor's probe shape. Resolves the
 * id the daemon reports, or `null` on any refusal, timeout, non-2xx status,
 * oversized body or unparseable body (the leg that rejects an unrelated
 * process squatting a recycled port).
 */
export function probeIdentity(
	port: number,
	token: string,
	timeoutMs: number = PROBE_TIMEOUT_FAST_MS,
): Promise<string | null> {
	return new Promise((resolve) => {
		let settled = false;
		const finish = (id: string | null) => {
			if (settled) return;
			settled = true;
			resolve(id);
		};
		const request = http.get(
			{
				host: "127.0.0.1",
				port,
				path: HEALTH_PATH,
				headers: { authorization: `Bearer ${token}` },
				timeout: timeoutMs,
			},
			(response) => {
				const status = response.statusCode ?? 0;
				if (status < 200 || status >= 300) {
					response.resume();
					finish(null);
					return;
				}
				const chunks: Buffer[] = [];
				let totalBytes = 0;
				response.on("data", (chunk: Buffer) => {
					totalBytes += chunk.length;
					if (totalBytes > MAX_PROBE_RESPONSE_BYTES) {
						response.destroy();
						finish(null);
						return;
					}
					chunks.push(chunk);
				});
				response.on("end", () => {
					try {
						const parsed = JSON.parse(
							Buffer.concat(chunks).toString("utf8"),
						) as unknown;
						const record = parsed as Record<string, unknown> | null;
						const id =
							record && typeof record === "object" ? record.id : undefined;
						finish(typeof id === "string" ? id : null);
					} catch {
						finish(null);
					}
				});
				response.on("error", () => finish(null));
			},
		);
		// The timeout handler settles the promise itself: in bun a request
		// that never connected emits no 'error' even after destroy(err), so
		// relying on the error event would leak the promise on a silent port.
		// A timeout is inconclusive (null), never a foreign answer.
		request.on("timeout", () => {
			request.destroy();
			finish(null);
		});
		request.on("error", () => finish(null));
	});
}

export type EntryVerdict = "live" | "dead" | "unverified";

export interface EntryClassification {
	readonly verdict: EntryVerdict;
	/** Which positive-evidence leg fired — present only when dead. */
	readonly reason?: "pid-gone" | "pre-boot" | "foreign-id";
}

/**
 * The two hygiene predicates in one classification (S08 R / D3):
 *
 * - `live` — all three legs pass: current-boot numeric `startedAt`, pid alive
 *   under the EPERM rule, and the probe positively echoing the entry id.
 *   Required for routing and for ensure reuse.
 * - `dead` — positive evidence of death only: pid gone (`ESRCH`), or
 *   `startedAt` predates the current boot (kills PID-reuse-after-reboot even
 *   when a live unrelated process holds the pid), or the probe positively
 *   answers as a *different* daemon (a squatter). Sufficient for reaping.
 * - `unverified` — everything else (pid alive, probe refused/timed out,
 *   including a pre-`/health` daemon from an older CLI, or a missing secret).
 *   Never routed to, never reaped: fail closed.
 *
 * Legacy entries never route; they reap only once their pid is confirmed
 * gone (a legacy daemon that is still running reads unverified, not dead —
 * pre-boot semantics apply to *numeric* entries, where they catch PID reuse).
 */
export async function classifyEntry(
	entry: TargetEntry,
	secret: TargetSecret | null,
	options?: {
		readonly timeoutMs?: number;
		readonly bootMs?: number;
	},
): Promise<EntryClassification> {
	if (entry.legacyStartedAt !== undefined) {
		return pidAlive(entry.pid)
			? { verdict: "unverified" }
			: { verdict: "dead", reason: "pid-gone" };
	}
	const bootMs = options?.bootMs ?? osBootTimeMs();
	if (entry.startedAt < bootMs) return { verdict: "dead", reason: "pre-boot" };
	if (!pidAlive(entry.pid)) return { verdict: "dead", reason: "pid-gone" };
	if (secret === null) return { verdict: "unverified" };
	const probed = await probeIdentity(
		entry.port,
		secret.token,
		options?.timeoutMs,
	);
	if (probed === entry.id) return { verdict: "live" };
	if (probed === null) return { verdict: "unverified" };
	return { verdict: "dead", reason: "foreign-id" };
}

export interface AmbiguousCandidate {
	readonly id: string;
	readonly projectPath: string;
}

/**
 * `auto` refused to pick between two or more live targets (S08 R / D2): the
 * old newest-first pick was the silent-misrouting damage vector this change
 * exists to kill. Carries every candidate so the CLI can list them.
 */
export class AmbiguousTargetsError extends Error {
	readonly candidates: readonly AmbiguousCandidate[];
	constructor(candidates: readonly AmbiguousCandidate[]) {
		super(
			`auto is ambiguous: ${candidates.length} live targets — ` +
				candidates
					.map((candidate) => `${candidate.id} (${candidate.projectPath})`)
					.join(" | ") +
				". Pass --project <dir> or --target <id>.",
		);
		this.name = "AmbiguousTargetsError";
		this.candidates = candidates;
	}
}

/**
 * The single comparison key for project identity — the host's
 * `normalizeProjectPath` discipline: real path where it resolves (symlinks
 * collapse), `path.resolve` otherwise; separators to `/`; case-folded only on
 * win32 (NTFS is case-insensitive; folding elsewhere would collapse two
 * distinct directories into one key).
 */
export function normalizeProjectKey(projectPath: string): string {
	let resolved: string;
	try {
		resolved = realpathSync.native(projectPath);
	} catch {
		resolved = path.resolve(projectPath);
	}
	let normalized = path.normalize(resolved).split(path.sep).join("/");
	if (process.platform === "win32") {
		normalized = normalized.toLowerCase();
	}
	return normalized;
}

function parseEntry(value: unknown): TargetEntry | null {
	if (typeof value !== "object" || value === null) return null;
	const record = value as Record<string, unknown>;
	if (
		typeof record.id !== "string" ||
		typeof record.port !== "number" ||
		typeof record.pid !== "number" ||
		typeof record.projectPath !== "string"
	) {
		return null;
	}
	const lastActivityAt =
		typeof record.lastActivityAt === "number"
			? { lastActivityAt: record.lastActivityAt }
			: {};
	if (typeof record.startedAt === "number") {
		return {
			id: record.id,
			port: record.port,
			pid: record.pid,
			projectPath: record.projectPath,
			startedAt: record.startedAt,
			...lastActivityAt,
		};
	}
	// Legacy serialization (ISO string) or garbage: stamp the CONVERSION
	// moment + keep the original for display. The stamp must not be a
	// pre-boot sentinel: register/remove/patchEntry rewrite the whole index,
	// and a `startedAt: 0` written back re-reads as numeric (the legacy
	// marker drops) — pre-boot-dead regardless of pid, manufacturing death
	// for a still-running pre-contract daemon. The conversion moment is the
	// honest bound — the daemon started at or before it, nothing earlier is
	// known — and keeps the entry fail-closed (a pre-`/health` daemon never
	// answers the identity probe) until its pid is confirmed gone.
	return {
		id: record.id,
		port: record.port,
		pid: record.pid,
		projectPath: record.projectPath,
		startedAt: Date.now(),
		legacyStartedAt: String(record.startedAt),
		...lastActivityAt,
	};
}

function parseSecret(value: unknown): TargetSecret | null {
	if (typeof value !== "object" || value === null) return null;
	const record = value as Record<string, unknown>;
	if (
		typeof record.id !== "string" ||
		typeof record.port !== "number" ||
		typeof record.token !== "string"
	) {
		return null;
	}
	return { id: record.id, port: record.port, token: record.token };
}

export class TargetRegistry {
	private readonly rootPath: string;

	constructor(root: string) {
		this.rootPath = root;
	}

	/** The registry root (ensure forwards it to spawned daemons). */
	get root(): string {
		return this.rootPath;
	}

	private get indexPath(): string {
		return path.join(this.rootPath, "targets.json");
	}

	private secretPath(id: string): string {
		return path.join(this.rootPath, "targets", `${id}.json`);
	}

	/**
	 * Temp-file-then-rename so a crash mid-write never truncates the index —
	 * the same accepted non-atomicity class as the host supervisor's
	 * `reapEntries` (documented there, not fixed here: no lease exists).
	 */
	private async writeIndex(entries: readonly TargetEntry[]): Promise<void> {
		const temp = `${this.indexPath}.${randomBytes(4).toString("hex")}.tmp`;
		try {
			await writeFile(temp, JSON.stringify(entries, null, "\t"), "utf8");
			await rename(temp, this.indexPath);
		} catch (error) {
			await rm(temp, { force: true }).catch(() => undefined);
			throw error;
		}
	}

	async register(args: {
		readonly entry: TargetEntry;
		readonly secret: TargetSecret;
	}): Promise<void> {
		await mkdir(path.join(this.rootPath, "targets"), { recursive: true });
		const existing = await this.list();
		const next = [
			args.entry,
			...existing.filter((entry) => entry.id !== args.entry.id),
		];
		await this.writeIndex(next);
		await writeFile(
			this.secretPath(args.secret.id),
			JSON.stringify(args.secret, null, "\t"),
			"utf8",
		);
	}

	async list(): Promise<readonly TargetEntry[]> {
		if (!existsSync(this.indexPath)) return [];
		try {
			const parsed = JSON.parse(await readFile(this.indexPath, "utf8")) as
				| unknown[]
				| unknown;
			if (!Array.isArray(parsed)) return [];
			return parsed
				.map(parseEntry)
				.filter((entry): entry is TargetEntry => entry !== null);
		} catch {
			return [];
		}
	}

	async readSecret(id: string): Promise<TargetSecret | null> {
		const file = this.secretPath(id);
		if (!existsSync(file)) return null;
		try {
			const secret = parseSecret(
				JSON.parse(await readFile(file, "utf8")) as unknown,
			);
			return secret !== null && secret.id === id ? secret : null;
		} catch {
			return null;
		}
	}

	async remove(id: string): Promise<void> {
		const existing = await this.list();
		await this.writeIndex(existing.filter((entry) => entry.id !== id));
		await rm(this.secretPath(id), { force: true });
	}

	/**
	 * In-place field update on an existing entry — no head-move, no reorder
	 * (`register()` PREPENDS, so re-registering would reorder the index; the
	 * daemon's activity sync must not). Returns false when the id is unknown.
	 */
	async patchEntry(
		id: string,
		fields: { readonly lastActivityAt: number },
	): Promise<boolean> {
		const entries = [...(await this.list())];
		const index = entries.findIndex((entry) => entry.id === id);
		if (index < 0) return false;
		entries[index] = { ...entries[index], ...fields };
		await this.writeIndex(entries);
		return true;
	}

	/**
	 * Resolve a selector to a confirmed-live target. `auto` requires exactly
	 * one live target: zero resolves to null (no match, as today); two or
	 * more throws {@link AmbiguousTargetsError} instead of picking one — the
	 * newest-first pick it replaces was the silent-misrouting damage vector.
	 */
	async resolve(
		selector: string,
		options?: { readonly timeoutMs?: number },
	): Promise<ResolvedTarget | null> {
		if (selector === "auto") {
			const live: ResolvedTarget[] = [];
			for (const entry of await this.list()) {
				const secret = await this.readSecret(entry.id);
				if (
					secret !== null &&
					(await classifyEntry(entry, secret, options)).verdict === "live"
				) {
					live.push({ entry, secret });
				}
			}
			if (live.length === 0) return null;
			if (live.length >= 2) {
				throw new AmbiguousTargetsError(
					live.map(({ entry }) => entry),
				);
			}
			return live[0];
		}
		for (const entry of await this.list()) {
			if (entry.id !== selector) continue;
			const secret = await this.readSecret(entry.id);
			if (
				secret !== null &&
				(await classifyEntry(entry, secret, options)).verdict === "live"
			) {
				return { entry, secret };
			}
		}
		return null;
	}

	/**
	 * Resolve by project identity: exact normalized-path match against
	 * `entry.projectPath`, routed only through a confirmed-live entry —
	 * regardless of index order or start recency.
	 */
	async resolveForProject(
		projectPath: string,
		options?: { readonly timeoutMs?: number },
	): Promise<ResolvedTarget | null> {
		const key = normalizeProjectKey(projectPath);
		for (const entry of await this.list()) {
			if (normalizeProjectKey(entry.projectPath) !== key) continue;
			const secret = await this.readSecret(entry.id);
			if (
				secret !== null &&
				(await classifyEntry(entry, secret, options)).verdict === "live"
			) {
				return { entry, secret };
			}
		}
		return null;
	}

	/** Classify every entry (reap and ensure's fail-closed path work off this). */
	async classifyAll(options?: {
		readonly timeoutMs?: number;
	}): Promise<
		readonly {
			readonly entry: TargetEntry;
			readonly secret: TargetSecret | null;
			readonly classification: EntryClassification;
		}[]
	> {
		const classified: {
			entry: TargetEntry;
			secret: TargetSecret | null;
			classification: EntryClassification;
		}[] = [];
		for (const entry of await this.list()) {
			const secret = await this.readSecret(entry.id);
			classified.push({
				entry,
				secret,
				classification: await classifyEntry(entry, secret, options),
			});
		}
		return classified;
	}
}

export function defaultRegistryRoot(): string {
	const override = process.env.ROCUT_TARGETS_ROOT;
	if (override && override.trim() !== "") return override;
	const home = process.env.HOME ?? process.env.USERPROFILE ?? ".";
	return path.join(home, ".rocut");
}

/** sha256 of the normalized project key, first 8 hex — the collision suffix. */
export function projectIdDigest(projectKey: string): string {
	return createHash("sha256").update(projectKey).digest("hex").slice(0, 8);
}

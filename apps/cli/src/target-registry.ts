/**
 * The host target registry (S06 C3, director-precedent shape).
 *
 * Two files with different trust levels:
 *
 * - `<root>/targets.json` — public metadata for `target list`: id, port,
 *   project, pid, startedAt. Never the token, never the URL.
 * - `<root>/targets/<id>.json` — the connection secret (port + token) a
 *   `--target` client reads to reconnect. Credential URLs are printed only on
 *   explicit `host start` and never appear in any listing.
 */
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

export interface TargetEntry {
	readonly id: string;
	readonly port: number;
	readonly pid: number;
	readonly projectPath: string;
	readonly startedAt: string;
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

export class TargetRegistry {
	private readonly root: string;

	constructor(root: string) {
		this.root = root;
	}

	private get indexPath(): string {
		return path.join(this.root, "targets.json");
	}

	private secretPath(id: string): string {
		return path.join(this.root, "targets", `${id}.json`);
	}

	async register(args: {
		readonly entry: TargetEntry;
		readonly secret: TargetSecret;
	}): Promise<void> {
		await mkdir(path.join(this.root, "targets"), { recursive: true });
		const existing = await this.list();
		const next = [
			args.entry,
			...existing.filter((e) => e.id !== args.entry.id),
		];
		await writeFile(this.indexPath, JSON.stringify(next, null, "\t"), "utf8");
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
				| TargetEntry[]
				| unknown;
			return Array.isArray(parsed) ? (parsed as TargetEntry[]) : [];
		} catch {
			return [];
		}
	}

	async remove(id: string): Promise<void> {
		const existing = await this.list();
		await writeFile(
			this.indexPath,
			JSON.stringify(
				existing.filter((e) => e.id !== id),
				null,
				"\t",
			),
			"utf8",
		);
		await rm(this.secretPath(id), { force: true });
	}

	/** `auto` resolves to the most recent entry whose process is still alive. */
	async resolve(selector: string): Promise<ResolvedTarget | null> {
		const wanted = selector === "auto" ? undefined : selector;
		const entries = await this.list();
		const candidates = wanted
			? entries.filter((entry) => entry.id === wanted)
			: entries; // index order is newest-first
		for (const entry of candidates) {
			if (!this.alive(entry)) continue;
			const secretFile = this.secretPath(entry.id);
			if (!existsSync(secretFile)) continue;
			try {
				const secret = JSON.parse(
					await readFile(secretFile, "utf8"),
				) as TargetSecret;
				if (secret.id === entry.id) return { entry, secret };
			} catch {
				// Unreadable secret: skip, the host is effectively gone.
			}
		}
		return null;
	}

	private alive(entry: TargetEntry): boolean {
		try {
			if (process.platform === "win32") {
				// process.kill with signal 0 is a pure liveness probe.
				process.kill(entry.pid, 0);
				return true;
			}
			process.kill(entry.pid, 0);
			return true;
		} catch {
			return false;
		}
	}
}

export function defaultRegistryRoot(): string {
	const override = process.env.ROCUT_TARGETS_ROOT;
	if (override && override.trim() !== "") return override;
	const home = process.env.HOME ?? process.env.USERPROFILE ?? ".";
	return path.join(home, ".rocut");
}

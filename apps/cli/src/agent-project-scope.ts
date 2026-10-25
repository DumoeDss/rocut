import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";

export const AGENT_PROJECT_ROOT_ENV = "ELFTIA_AGENT_PROJECT_ROOT";
const key = (value: string) =>
	process.platform === "win32" ? value.toLowerCase() : value;
const failure = () =>
	new Error(
		"Rocut target is outside the active Agent project or unavailable. Call recover_production({restoreEnvironment:true}) and use its current target; do not substitute another project target.",
	);

/** Accidental cross-project routing fence, not a sandbox for arbitrary shell code. */
export class AgentProjectScope {
	readonly root: string;
	constructor(root: string) {
		if (!root.trim() || !path.isAbsolute(root)) throw failure();
		this.root = this.canonical(root, false);
	}
	private canonical(value: string, allowMissing: boolean): string {
		const absolute = path.resolve(value);
		let existing = absolute;
		const missing: string[] = [];
		for (;;) {
			try {
				const stat = lstatSync(existing);
				if (
					!stat.isDirectory() ||
					stat.isSymbolicLink() ||
					key(realpathSync(existing)) !== key(existing)
				)
					throw failure();
				return path.join(realpathSync(existing), ...missing.reverse());
			} catch (error) {
				if (!allowMissing || (error as NodeJS.ErrnoException).code !== "ENOENT")
					throw failure();
				const parent = path.dirname(existing);
				if (parent === existing) throw failure();
				missing.push(path.basename(existing));
				existing = parent;
			}
		}
	}
	assertProject(value: string, allowMissing = false): void {
		if (key(this.canonical(this.root, false)) !== key(this.root))
			throw failure();
		const candidate = this.canonical(value, allowMissing);
		const relative = path.relative(key(this.root), key(candidate));
		if (
			relative === ".." ||
			relative.startsWith(`..${path.sep}`) ||
			path.isAbsolute(relative)
		)
			throw failure();
	}
	allows(value: string): boolean {
		try {
			this.assertProject(value);
			return true;
		} catch {
			return false;
		}
	}
}

export function agentProjectScope(
	env: NodeJS.ProcessEnv = process.env,
): AgentProjectScope | undefined {
	const root = env[AGENT_PROJECT_ROOT_ENV];
	return root === undefined ? undefined : new AgentProjectScope(root);
}

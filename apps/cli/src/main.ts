/**
 * The rocut CLI entry (S06 C3) — the sole agent automation surface rocut
 * ships (design 26.7 / D24 law 1). Two faces of one core: `host start` runs
 * the local backend (web surface + automation entry, authenticated loopback
 * origin, agent-owned lifetime) and `host ensure` is the idempotent join
 * verb (S08 R: detached start-if-absent, bounded registry wait, exits);
 * `read`/`verify`/`apply`/`draft` route to a running host by `--target` id,
 * `--project` path, or `auto` (exactly one live target, else an explicit
 * error). `target list` reconnects by id; credential URLs are printed only
 * on explicit `host start` / `host ensure` and never listed.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startHost } from "./host";
import { ensureHost } from "./ensure";
import {
	normalizeProjectKey,
	PROBE_TIMEOUT_FAST_MS,
	TargetRegistry,
	defaultRegistryRoot,
	type ResolvedTarget,
} from "./target-registry";

interface Args {
	readonly positional: string[];
	readonly flags: ReadonlyMap<string, string | true>;
}

function parseArgs(argv: readonly string[]): Args {
	const positional: string[] = [];
	const flags = new Map<string, string | true>();
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (!arg.startsWith("--")) {
			positional.push(arg);
			continue;
		}
		const flag = arg.slice(2);
		const next = argv[index + 1];
		if (next !== undefined && !next.startsWith("--")) {
			flags.set(flag, next);
			index += 1;
		} else {
			flags.set(flag, true);
		}
	}
	return { positional, flags };
}

function flag(args: Args, name: string): string | undefined {
	const value = args.flags.get(name);
	return typeof value === "string" ? value : undefined;
}

async function request(
	secret: { port: number; token: string },
	method: "GET" | "POST",
	route: string,
	body?: unknown,
): Promise<unknown> {
	const response = await fetch(
		`http://127.0.0.1:${secret.port}/${secret.token}/api/${route}`,
		{
			method,
			...(body === undefined
				? {}
				: {
						headers: { "content-type": "application/json" },
						body: JSON.stringify(body),
					}),
		},
	);
	const parsed = (await response.json()) as unknown;
	if (!response.ok) {
		const message =
			typeof parsed === "object" &&
			parsed !== null &&
			"message" in parsed &&
			typeof (parsed as { message: unknown }).message === "string"
				? (parsed as { message: string }).message
				: response.statusText;
		throw new Error(
			`${method} /${route} failed (${response.status}): ${message}`,
		);
	}
	return parsed;
}

/**
 * Selector precedence: explicit `--target <id>` > `--project <dir>` > `auto`.
 * All three route only through confirmed-live entries; `auto` with two or
 * more live targets throws the ambiguity error listing the candidates.
 */
async function resolveTarget(
	args: Args,
	registry: TargetRegistry,
): Promise<ResolvedTarget> {
	const target = flag(args, "target");
	if (target !== undefined) {
		const resolved = await registry.resolve(target, {
			timeoutMs: PROBE_TIMEOUT_FAST_MS,
		});
		if (resolved === null) {
			throw new Error(`no live target matches --target ${target}`);
		}
		return resolved;
	}
	const project = flag(args, "project");
	if (project !== undefined) {
		const resolved = await registry.resolveForProject(project, {
			timeoutMs: PROBE_TIMEOUT_FAST_MS,
		});
		if (resolved === null) {
			throw new Error(`no live target matches --project ${project}`);
		}
		return resolved;
	}
	const resolved = await registry.resolve("auto", {
		timeoutMs: PROBE_TIMEOUT_FAST_MS,
	});
	if (resolved === null) {
		throw new Error("no live target matches --target auto");
	}
	return resolved;
}

/** The usage block — one array so the snapshot test and --help stay honest. */
export const USAGE_LINES: readonly string[] = [
	"usage:",
	"  rocut host start <project-dir> [--static <dist>] [--port <n>]",
	"  rocut host ensure <project-dir> [--static <dist>] [--port <n>] [--timeout <ms>] [--log <file>]",
	"  rocut target list",
	"  rocut target reap [--project <dir>] [--dry-run]",
	"  rocut read [--target <id|auto>] [--project <dir>]",
	"  rocut verify <tick> [--target <id|auto>] [--project <dir>]",
	"  rocut apply <ops.json> [--target <id|auto>] [--project <dir>]",
	"  rocut draft begin [--target <id|auto>] [--project <dir>]",
	"  rocut draft stage <ops.json> --draft <id> [--target <id|auto>] [--project <dir>]",
	"  rocut draft approve|reject|discard --draft <id> [--target <id|auto>] [--project <dir>]",
];

async function runCli(argv: readonly string[]): Promise<void> {
	const [command, ...rest] = argv;
	const args = parseArgs(rest);
	const registry = new TargetRegistry(
		flag(args, "targets-root") ?? defaultRegistryRoot(),
	);

	switch (command) {
		case "host": {
			const subcommand = args.positional[0];
			const projectDir = args.positional[1];
			if (projectDir === undefined) {
				throw new Error(
					`host ${subcommand ?? "<verb>"} requires a project directory`,
				);
			}
			const staticDir = flag(args, "static");
			const portFlag = flag(args, "port");
			if (subcommand === "start") {
				const host = await startHost({
					projectRoot: projectDir,
					...(staticDir === undefined ? {} : { staticDir }),
					...(portFlag === undefined ? {} : { port: Number(portFlag) }),
					registry,
				});
				process.stdout.write(`target ${host.targetId}\n`);
				process.stdout.write(`editorUrl ${host.editorUrl}\n`);
				process.stdout.write(`pid ${process.pid}\n`);
				await new Promise<void>(() => undefined); // foreground; agent owns the lifetime
				return;
			}
			if (subcommand === "ensure") {
				const timeoutFlag = flag(args, "timeout");
				const logFile = flag(args, "log");
				const ensured = await ensureHost({
					projectRoot: projectDir,
					registry,
					...(staticDir === undefined ? {} : { staticDir }),
					...(portFlag === undefined ? {} : { port: Number(portFlag) }),
					...(timeoutFlag === undefined
						? {}
						: { timeoutMs: Number(timeoutFlag) }),
					...(logFile === undefined ? {} : { logFile }),
				});
				process.stdout.write(`target ${ensured.targetId}\n`);
				process.stdout.write(`editorUrl ${ensured.editorUrl}\n`);
				process.stdout.write(`pid ${ensured.pid}\n`);
				process.stdout.write(`state ${ensured.state}\n`);
				return;
			}
			throw new Error(
				"usage: rocut host start <project-dir> [--static <dist>] [--port <n>] | " +
					"rocut host ensure <project-dir> [--static <dist>] [--port <n>] [--timeout <ms>] [--log <file>]",
			);
		}
		case "target": {
			const subcommand = args.positional[0];
			if (subcommand === "list") {
				const entries = await registry.list();
				if (entries.length === 0) {
					process.stdout.write("no targets\n");
					return;
				}
				for (const entry of entries) {
					process.stdout.write(
						`${entry.id}  port=${entry.port}  pid=${entry.pid}  project=${entry.projectPath}  started=${entry.startedAt}` +
							`${entry.lastActivityAt === undefined ? "" : `  lastActive=${entry.lastActivityAt}`}\n`,
					);
				}
				return;
			}
			if (subcommand === "reap") {
				const scopeProject = flag(args, "project");
				const dryRun = args.flags.has("dry-run");
				const scopeKey =
					scopeProject === undefined
						? undefined
						: normalizeProjectKey(scopeProject);
				const classified = await registry.classifyAll();
				if (classified.length === 0) {
					process.stdout.write("no targets\n");
					return;
				}
				for (const { entry, classification } of classified) {
					if (
						scopeKey !== undefined &&
						normalizeProjectKey(entry.projectPath) !== scopeKey
					) {
						continue;
					}
					if (classification.verdict === "dead") {
						if (!dryRun) {
							await registry.remove(entry.id);
						}
						process.stdout.write(
							`${entry.id}: dead (${classification.reason}) — ${dryRun ? "dry-run, kept" : "removed"}\n`,
						);
						continue;
					}
					if (classification.verdict === "live") {
						process.stdout.write(`${entry.id}: live\n`);
						continue;
					}
					process.stdout.write(
						`${entry.id}: unverified — pid ${entry.pid} alive but identity inconclusive; ` +
							"confirm and reap again, or stop the process by hand\n",
					);
				}
				return;
			}
			throw new Error(
				"usage: rocut target list | rocut target reap [--project <dir>] [--dry-run]",
			);
		}
		case "read": {
			const resolved = await resolveTarget(args, registry);
			const context = (await request(resolved.secret, "GET", "context")) as {
				revision: number;
				project: { name: string } | null;
			};
			const tracks = (await request(
				resolved.secret,
				"GET",
				"tracks",
			)) as unknown[];
			process.stdout.write(
				JSON.stringify(
					{
						target: resolved.entry.id,
						revision: context.revision,
						project: context.project?.name ?? null,
						tracks: tracks.length,
					},
					null,
					"\t",
				) + "\n",
			);
			return;
		}
		case "verify": {
			// The composed-frame proof (S07): digest the frame at a tick.
			const at = args.positional[0];
			if (at === undefined || !/^\d+$/.test(at)) {
				throw new Error(
					"verify requires a MediaTime tick argument (120000 ticks = 1s)",
				);
			}
			const resolved = await resolveTarget(args, registry);
			const proof = (await request(
				resolved.secret,
				"GET",
				`frame?at=${at}`,
			)) as {
				revision: number | null;
				digest: string;
				description: {
					frameIndex: number;
					elements: { id: string; type: string; z: number }[];
					assets: { id: string; kind: string }[];
				};
			};
			process.stdout.write(
				JSON.stringify(
					{
						target: resolved.entry.id,
						revision: proof.revision,
						at: Number(at),
						frameIndex: proof.description.frameIndex,
						digest: proof.digest,
						elements: proof.description.elements.map(
							(element) => `${element.z}:${element.type}:${element.id}`,
						),
						assets: proof.description.assets.map(
							(asset) => `${asset.kind}:${asset.id}`,
						),
					},
					null,
					"\t",
				) + "\n",
			);
			return;
		}
		case "apply": {
			const operationsFile = args.positional[0];
			if (operationsFile === undefined) {
				throw new Error("apply requires an operations JSON file");
			}
			const resolved = await resolveTarget(args, registry);
			const batch = JSON.parse(await readFile(operationsFile, "utf8")) as {
				operations: never[];
				expectedRevision?: number;
				idempotencyKey?: string;
			};
			const result = await request(resolved.secret, "POST", "apply", batch);
			process.stdout.write(JSON.stringify(result, null, "\t") + "\n");
			return;
		}
		case "draft": {
			if (args.flags.has("mode")) {
				// Removed from the CLI, loudly (S08 R / D6): never silently
				// ignored. The contract and the HTTP surface keep approvalMode —
				// the editor surface owns that path.
				throw new Error(
					"--mode has been removed from the CLI; approval mode is set by the editor surface",
				);
			}
			const subcommand = args.positional[0];
			const resolved = await resolveTarget(args, registry);
			if (subcommand === "begin") {
				const opened = (await request(resolved.secret, "POST", "drafts", {
					approvalMode: "manual",
				})) as { opened: boolean; draftId?: string };
				if (!opened.opened || opened.draftId === undefined) {
					throw new Error("draft begin was rejected by the host");
				}
				process.stdout.write(`${opened.draftId}\n`);
				return;
			}
			const draftId = flag(args, "draft");
			if (draftId === undefined) {
				throw new Error(
					"draft commands require --draft <id> (from draft begin)",
				);
			}
			if (subcommand === "stage") {
				const operationsFile = args.positional[1];
				if (operationsFile === undefined) {
					throw new Error("draft stage requires an operations JSON file");
				}
				const batch = JSON.parse(await readFile(operationsFile, "utf8")) as {
					operations: never[];
				};
				const outcome = await request(
					resolved.secret,
					"POST",
					`drafts/${draftId}/stage`,
					batch,
				);
				process.stdout.write(JSON.stringify(outcome, null, "\t") + "\n");
				return;
			}
			if (
				subcommand === "approve" ||
				subcommand === "reject" ||
				subcommand === "discard"
			) {
				const outcome = await request(
					resolved.secret,
					"POST",
					`drafts/${draftId}/${subcommand}`,
				);
				process.stdout.write(JSON.stringify(outcome, null, "\t") + "\n");
				return;
			}
			throw new Error(
				"usage: rocut draft begin [--target <id|auto>|--project <dir>] | " +
					"stage <ops.json> --draft <id> | approve|reject|discard --draft <id>",
			);
		}
		default:
			process.stdout.write(USAGE_LINES.join("\n") + "\n");
	}
}

export { runCli };

function main(): void {
	runCli(process.argv.slice(2)).catch((error: unknown) => {
		process.stderr.write(
			`rocut: ${error instanceof Error ? error.message : String(error)}\n`,
		);
		process.exitCode = 1;
	});
}

// Entry guard: tests import runCli/USAGE_LINES from this module; only a real
// `bun …/main.ts <verb>` invocation (source CLI or packed bundle — the very
// spawn shape `host ensure` reconstructs) dispatches.
const invokedAsEntry = (() => {
	if (process.argv[1] === undefined) return false;
	const self = fileURLToPath(import.meta.url);
	const invoked = resolve(process.argv[1]);
	const same =
		self === invoked ||
		(process.platform === "win32" &&
			self.toLowerCase() === invoked.toLowerCase());
	return same;
})();

if (invokedAsEntry) {
	main();
}

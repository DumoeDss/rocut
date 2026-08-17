/**
 * The rocut CLI entry (S06 C3) — the sole agent automation surface rocut
 * ships (design 26.7 / D24 law 1). Two faces of one core: `host start` runs
 * the local backend (web surface + automation entry, authenticated loopback
 * origin, agent-owned lifetime); `read`/`apply --target` route to a running
 * host. `target list` reconnects by id; credential URLs are printed only on
 * explicit `host start` and never listed.
 */
import { readFile } from "node:fs/promises";
import { startHost } from "./host";
import { TargetRegistry, defaultRegistryRoot } from "./target-registry";

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

async function main(): Promise<void> {
	const [command, ...rest] = process.argv.slice(2);
	const args = parseArgs(rest);
	const registry = new TargetRegistry(
		flag(args, "targets-root") ?? defaultRegistryRoot(),
	);

	switch (command) {
		case "host": {
			const subcommand = args.positional[0];
			if (subcommand !== "start") {
				throw new Error(
					"usage: rocut host start <project-dir> [--static <dist>] [--port <n>]",
				);
			}
			const projectDir = args.positional[1];
			if (projectDir === undefined) {
				throw new Error("host start requires a project directory");
			}
			const staticDir = flag(args, "static");
			const portFlag = flag(args, "port");
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
						`${entry.id}  port=${entry.port}  pid=${entry.pid}  project=${entry.projectPath}  started=${entry.startedAt}\n`,
					);
				}
				return;
			}
			throw new Error("usage: rocut target list");
		}
		case "read": {
			const selector = flag(args, "target") ?? "auto";
			const resolved = await registry.resolve(selector);
			if (resolved === null)
				throw new Error(`no live target matches --target ${selector}`);
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
		case "apply": {
			const selector = flag(args, "target") ?? "auto";
			const operationsFile = args.positional[0];
			if (operationsFile === undefined) {
				throw new Error("apply requires an operations JSON file");
			}
			const resolved = await registry.resolve(selector);
			if (resolved === null)
				throw new Error(`no live target matches --target ${selector}`);
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
			const subcommand = args.positional[0];
			const selector = flag(args, "target") ?? "auto";
			const resolved = await registry.resolve(selector);
			if (resolved === null)
				throw new Error(`no live target matches --target ${selector}`);
			if (subcommand === "begin") {
				const mode = flag(args, "mode") === "auto" ? "auto" : "manual";
				const opened = (await request(resolved.secret, "POST", "drafts", {
					approvalMode: mode,
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
				"usage: rocut draft begin [--mode manual|auto] | stage <ops.json> --draft <id> | approve|reject|discard --draft <id>",
			);
		}
		default:
			process.stdout.write(
				[
					"usage:",
					"  rocut host start <project-dir> [--static <dist>] [--port <n>]",
					"  rocut target list",
					"  rocut read [--target <id|auto>]",
					"  rocut apply <ops.json> [--target <id|auto>]",
					"  rocut draft begin [--mode manual|auto] [--target <id|auto>]",
					"  rocut draft stage <ops.json> --draft <id> [--target <id|auto>]",
					"  rocut draft approve|reject|discard --draft <id> [--target <id|auto>]",
				].join("\n") + "\n",
			);
	}
}

main().catch((error: unknown) => {
	process.stderr.write(
		`rocut: ${error instanceof Error ? error.message : String(error)}\n`,
	);
	process.exitCode = 1;
});

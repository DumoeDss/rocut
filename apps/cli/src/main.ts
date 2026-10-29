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
import { deliverOutput, prepareOutputDestination } from "./output-delivery";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startHost } from "./host";
import { resolveHostStaticDirectory } from "./host-static-directory";
import { runAgentCli } from "./agent-cli";
import { runVideoPosterCli } from "./video-poster-cli";
import type { ExportJob } from "./host-export";
import { runSnapshotCli } from "./snapshot-cli";
import { runNativeReadCli } from "./native-read-cli";
import { runMusicGridCli } from "./music-grid-cli";
import { runCutPlanCli } from "./cut-plan-cli";
import { runMediaInstanceCli } from "./media-instance-cli";
import {
	parseVideoChromaFlag,
	parseVideoQuantizerFlag,
	requireQuantizerHost,
	requireHighChromaHost,
} from "./host-export-protocol";
import { ensureHost } from "./ensure";
import { agentProjectScope } from "./agent-project-scope";
import { CliRequestError, request } from "./host-request";
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
			throw new Error(
				`no live target matches --target ${target}${registry.recoveryHint}`,
			);
		}
		return resolved;
	}
	const project = flag(args, "project");
	if (project !== undefined) {
		const resolved = await registry.resolveForProject(project, {
			timeoutMs: PROBE_TIMEOUT_FAST_MS,
		});
		if (resolved === null) {
			throw new Error(
				`no live target matches --project ${project}${registry.recoveryHint}`,
			);
		}
		return resolved;
	}
	const resolved = await registry.resolve("auto", {
		timeoutMs: PROBE_TIMEOUT_FAST_MS,
	});
	if (resolved === null) {
		throw new Error(
			`no live target matches --target auto${registry.recoveryHint}`,
		);
	}
	return resolved;
}

/** The usage block — one array so the snapshot test and --help stay honest. */
export const USAGE_LINES: readonly string[] = [
	"usage:",
	"  rocut host start <project-dir> [--static <dist>] [--port <n>]",
	"  rocut host ensure <project-dir> [--static <dist>] [--port <n>] [--timeout <ms>] [--log <file>]",
	"  rocut target list",
	"  rocut video-poster capabilities|create (offline; create reads fixed JSON from stdin)",
	"  rocut target reap [--project <dir>] [--dry-run]",
	"  rocut read [--target <id|auto>] [--project <dir>]",
	"  rocut record [--target <id|auto>] [--project <dir>] (complete read-only native record)",
	"  rocut apply-status <original-batch.json> [--target <id|auto>] [--project <dir>] (read-only)",
	"  rocut programmatic-validate <source.json> [--target <id|auto>] [--project <dir>] (read-only Rust source validation)",
	"  rocut editing catalog [--target <id|auto>] [--project <dir>]",
	"  rocut music-grid capabilities|bindings|read|list|snap|validate|plan|edit <spec.json> [--target <id|auto>] [--project <dir>]",
	"  rocut music-grid project-anchors <query.json> <reviewed-anchors.json> [--target <id|auto>] [--project <dir>]",
	"  rocut cut-plan validate <spec.json> [--target <id|auto>] [--project <dir>] (read-only Rust validation)",
	"  rocut media-instance map <spec.json> [--target <id|auto>] [--project <dir>] (read-only instance clock)",
	"  rocut capabilities [--target <id|auto>] [--project <dir>]",
	"  rocut media import <spec.json> [--target <id|auto>] [--project <dir>]",
	"  rocut media import-status <original-spec.json> [--target <id|auto>] [--project <dir>] (read-only)",
	"  rocut resource import <spec.json> [--target <id|auto>] [--project <dir>]",
	"  rocut programmatic compile|rebuild <spec.json> [--target <id|auto>] [--project <dir>]",
	"  rocut programmatic revise <spec.json> [--target <id|auto>] [--project <dir>]",
	"  rocut programmatic inspect|compile-inspected <spec.json> [--target <id|auto>] [--project <dir>]",
	"  rocut programmatic audio-import <spec.json> [--target <id|auto>] [--project <dir>]",
	"  rocut programmatic sequence-import <spec.json> [--target <id|auto>] [--project <dir>]",
	"  rocut programmatic model-restore <spec.json> [--target <id|auto>] [--project <dir>]",
	"  rocut programmatic source-restore <spec.json> [--target <id|auto>] [--project <dir>]",
	"  rocut programmatic sequence-restore <spec.json> [--target <id|auto>] [--project <dir>]",
	"  rocut programmatic produced <spec.json> [--target <id|auto>] [--project <dir>]",
	"  rocut programmatic object-params <spec.json> [--target <id|auto>] [--project <dir>]",
	"  rocut programmatic animation-inspect <spec.json> [--target <id|auto>] [--project <dir>]",
	"  rocut task list|start <spec.json>|get <id>|cancel <id> [--target <id|auto>] [--project <dir>]",
	"  rocut scenes list|plan <spec.json> [--target <id|auto>] [--project <dir>]",
	"  rocut media-folders list|plan <spec.json> [--target <id|auto>] [--project <dir>]",
	"  rocut motion-text catalog [--target <id|auto>] [--project <dir>]",
	"  rocut motion-text list [--target <id|auto>] [--project <dir>]",
	"  rocut motion-text create <spec.json> [--target <id|auto>] [--project <dir>]",
	"  rocut motion-text create-cues <spec.json> [--preview] [--target <id|auto>] [--project <dir>]",
	"  rocut motion-text mutate <sequence-id> <mutation.json> [--preview] [--target <id|auto>] [--project <dir>]",
	"  rocut motion-text vary <sequence-id> <variation.json> [--apply] [--target <id|auto>] [--project <dir>]",
	"  rocut verify <tick> [--target <id|auto>] [--project <dir>]",
	"  rocut apply <ops.json> [--target <id|auto>] [--project <dir>]",
	"  rocut export --revision <n> --idempotency-key <key> [--out <file>] [--format mp4|webm] [--quality low|medium|high|very_high] [--video-chroma 420|444] [--video-quantizer <number>] [--no-audio] [--start-time <ticks> --end-time <ticks>] [--target <id|auto>] [--project <dir>]",
	"  rocut snapshot --tick <mediaTicks> [--out <png>] [--surface <id>] [--revision <n>] [--target <id|auto>] [--project <dir>]",
	"  rocut draft begin [--target <id|auto>] [--project <dir>]",
	"  rocut draft stage <ops.json> --draft <id> [--target <id|auto>] [--project <dir>]",
	"  rocut draft approve|reject|discard --draft <id> [--target <id|auto>] [--project <dir>]",
];

async function runCli(argv: readonly string[]): Promise<void> {
	// Help must never resolve the default live target or dispatch a command.
	if (argv.includes("--help")) {
		process.stdout.write(USAGE_LINES.join("\n") + "\n");
		return;
	}
	const [command, ...rest] = argv;
	if (command === "video-poster") {
		await runVideoPosterCli(rest);
		return;
	}
	const args = parseArgs(rest);
	if (command === "apply" && args.flags.has("dry-run"))
		throw new Error(
			"apply --dry-run is unsupported by this host protocol; no request was sent. Use read to inspect current state; read/verify do not validate an operations batch.",
		);
	const scope = agentProjectScope();
	const registry = new TargetRegistry(
		flag(args, "targets-root") ?? defaultRegistryRoot(),
		scope,
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
			scope?.assertProject(projectDir, true);
			const staticDir = await resolveHostStaticDirectory({
				explicit: flag(args, "static"),
				entryUrl: import.meta.url,
			});
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
				const entries = await registry.listScoped();
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
				if (scopeProject !== undefined)
					scope?.assertProject(scopeProject, true);
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
							await registry.remove(entry.id, entry);
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
				project: { id: string; name: string } | null;
			};
			const [tracks, clips, assets, markers, motionTextSequences] =
				(await Promise.all([
					request(resolved.secret, "GET", "tracks"),
					request(resolved.secret, "GET", "clips"),
					request(resolved.secret, "GET", "assets"),
					request(resolved.secret, "GET", "markers"),
					request(resolved.secret, "GET", "motion-text-sequences"),
				])) as [unknown[], unknown[], unknown[], unknown[], unknown[]];
			process.stdout.write(
				JSON.stringify(
					{
						target: resolved.entry.id,
						revision: context.revision,
						project: context.project?.name ?? null,
						projectEntity: context.project,
						tracks: tracks.length,
						clips: clips.length,
						assets: assets.length,
						markers: markers.length,
						motionTextSequences: motionTextSequences.length,
						entities: {
							tracks,
							clips,
							assets,
							markers,
							motionTextSequences,
						},
					},
					null,
					"\t",
				) + "\n",
			);
			return;
		}
		case "music-grid": {
			const result = await runMusicGridCli(args.positional, await resolveTarget(args, registry));
			process.stdout.write(JSON.stringify(result, null, "\t") + "\n");
			return;
		}
		case "cut-plan": {
			const result = await runCutPlanCli(args.positional, await resolveTarget(args, registry));
			process.stdout.write(JSON.stringify(result, null, "\t") + "\n");
			return;
		}
		case "media-instance": {
			const result = await runMediaInstanceCli(args.positional, await resolveTarget(args, registry));
			process.stdout.write(JSON.stringify(result, null, "\t") + "\n");
			return;
		}
		case "capabilities":
		case "media":
		case "resource":
		case "programmatic":
		case "editing":
		case "task":
		case "media-folders":
		case "scenes": {
			await runAgentCli({
				command,
				positional: args.positional,
				resolved: await resolveTarget(args, registry),
			});
			return;
		}
		case "motion-text": {
			const subcommand = args.positional[0];
			const resolved = await resolveTarget(args, registry);
			if (subcommand === "catalog") {
				const catalog = await request(
					resolved.secret,
					"GET",
					"motion-text/catalog",
				);
				process.stdout.write(
					JSON.stringify({ target: resolved.entry.id, catalog }, null, "\t") +
						"\n",
				);
				return;
			}
			if (subcommand === "list") {
				const [context, sequences] = (await Promise.all([
					request(resolved.secret, "GET", "context"),
					request(resolved.secret, "GET", "motion-text-sequences"),
				])) as [{ revision: number }, unknown[]];
				process.stdout.write(
					JSON.stringify(
						{
							target: resolved.entry.id,
							projectRevision: context.revision,
							sequences,
						},
						null,
						"\t",
					) + "\n",
				);
				return;
			}
			if (subcommand === "create" || subcommand === "create-cues") {
				if (
					subcommand === "create-cues" &&
					args.flags.has("preview") &&
					args.flags.has("apply")
				)
					throw new Error(
						"create-cues --preview cannot be combined with --apply",
					);
				const specFile = args.positional[1];
				if (specFile === undefined) {
					throw new Error("motion-text create requires a spec JSON file");
				}
				const spec: unknown = JSON.parse(await readFile(specFile, "utf8"));
				const outcome = await request(
					resolved.secret,
					"POST",
					subcommand === "create-cues"
						? `motion-text/create-cues${args.flags.has("preview") ? "-preview" : ""}`
						: "motion-text/sequences",
					spec,
				);
				process.stdout.write(JSON.stringify(outcome, null, "\t") + "\n");
				return;
			}
			if (subcommand === "mutate" || subcommand === "vary") {
				if (
					subcommand === "mutate" &&
					args.flags.has("preview") &&
					args.flags.has("apply")
				) {
					throw new Error(
						"motion-text mutate --preview cannot be combined with --apply",
					);
				}
				const sequenceId = args.positional[1];
				const specFile = args.positional[2];
				if (sequenceId === undefined || specFile === undefined) {
					throw new Error(
						`motion-text ${subcommand} requires a sequence id and JSON file`,
					);
				}
				const spec: unknown = JSON.parse(await readFile(specFile, "utf8"));
				const suffix =
					subcommand === "mutate"
						? args.flags.has("preview")
							? "mutation-previews"
							: "mutations"
						: `variations${args.flags.has("apply") ? "?apply=true" : ""}`;
				const outcome = await request(
					resolved.secret,
					"POST",
					`motion-text/sequences/${encodeURIComponent(sequenceId)}/${suffix}`,
					spec,
				);
				process.stdout.write(JSON.stringify(outcome, null, "\t") + "\n");
				return;
			}
			throw new Error(
				"usage: rocut motion-text catalog|list|create|mutate|vary (see rocut --help)",
			);
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
					schemaVersion: number;
					frameIndex: number;
					elements: { id: string; type: string; z: number }[];
					audio: { id: string; type: string }[];
					assets: { id: string; kind: string }[];
				};
			};
			if (proof.description.schemaVersion !== 2)
				throw new Error(
					"verify requires frame-proof schema 2; update and restart the target daemon. Schema 1 reports reversed visual stacking.",
				);
			process.stdout.write(
				JSON.stringify(
					{
						target: resolved.entry.id,
						revision: proof.revision,
						schemaVersion: proof.description.schemaVersion,
						visualOrder: "bottom-to-top",
						compositionOnly: true,
						at: Number(at),
						frameIndex: proof.description.frameIndex,
						digest: proof.digest,
						elements: proof.description.elements.map(
							(element) => `${element.z}:${element.type}:${element.id}`,
						),
						audio: proof.description.audio.map(
							(element) => `${element.type}:${element.id}`,
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
		case "record":
		case "programmatic-validate":
		case "apply-status": {
			const result = await runNativeReadCli(
				command,
				args.positional,
				await resolveTarget(args, registry),
			);
			process.stdout.write(JSON.stringify(result, null, "\t") + "\n");
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
		case "snapshot": {
			const tick = flag(args, "tick");
			if (tick === undefined || !/^\d+$/.test(tick))
				throw new Error(
					"snapshot requires --tick <non-negative integer mediaTicks>",
				);
			const revision = flag(args, "revision");
			if (
				args.flags.has("revision") &&
				(revision === undefined || !/^\d+$/.test(revision))
			)
				throw new Error("--revision requires a non-negative integer");
			for (const key of ["out", "surface", "project", "target"])
				if (args.flags.has(key) && flag(args, key) === undefined)
					throw new Error(`--${key} requires a value`);
			const resolved = await resolveTarget(args, registry);
			const project = flag(args, "project");
			if (
				project !== undefined &&
				normalizeProjectKey(project) !==
					normalizeProjectKey(resolved.entry.projectPath)
			)
				throw new Error("snapshot-project-target-conflict");
			const result = await runSnapshotCli({
				resolved,
				tick: Number(tick),
				out: flag(args, "out"),
				surfaceId: flag(args, "surface"),
				expectedRevision: revision === undefined ? undefined : Number(revision),
			});
			process.stdout.write(JSON.stringify(result, null, "\t") + "\n");
			return;
		}
		case "export": {
			const format = flag(args, "format") ?? "mp4";
			const videoQuantizer = parseVideoQuantizerFlag(
				args.flags.get("video-quantizer"),
			);
			const videoChroma = parseVideoChromaFlag(
				args.flags.get("video-chroma"),
				format,
			);
			// The host cannot rasterize (no canvas / WebGL / WebCodecs in Node),
			// so it directs the ATTACHED editor pane and writes what the pane
			// returns. With no pane open the host answers 409 up front rather
			// than accepting a job that could never run — that error is the
			// honest one to surface, not a hang.
			const resolved = await resolveTarget(args, registry);
			if (videoQuantizer !== undefined)
				await requireQuantizerHost(() =>
					request(resolved.secret, "GET", "export"),
				);
			if (videoChroma === "444")
				await requireHighChromaHost(() =>
					request(resolved.secret, "GET", "export"),
				);
			const startTime = flag(args, "start-time");
			const endTime = flag(args, "end-time");
			if ((startTime === undefined) !== (endTime === undefined)) {
				throw new Error(
					"export range requires both --start-time and --end-time in media ticks",
				);
			}
			const exportRevision = flag(args, "revision");
			const out = await prepareOutputDestination(flag(args, "out"));
			const exportKey = flag(args, "idempotency-key");
			if (
				exportRevision === undefined ||
				!/^\d+$/.test(exportRevision) ||
				!exportKey
			)
				throw new Error(
					"export requires --revision <n> and --idempotency-key <key>",
				);
			const exportContext = (await request(
				resolved.secret,
				"GET",
				"context",
			)) as { project: { id: string } };
			const started = (await request(resolved.secret, "POST", "export", {
				schemaVersion: 1,
				projectId: exportContext.project.id,
				expectedRevision: Number(exportRevision),
				idempotencyKey: exportKey,
				options: {
					format,
					...(videoQuantizer === undefined ? {} : { videoQuantizer }),
					...(videoChroma === undefined ? {} : { videoChroma }),
					quality: flag(args, "quality") ?? "high",
					...(args.flags.has("no-audio") ? { includeAudio: false } : {}),
					...(startTime === undefined || endTime === undefined
						? {}
						: {
								range: {
									startTime: Number(startTime),
									endTime: Number(endTime),
								},
							}),
				},
			})) as { jobId: string };
			const startedId = started.jobId;

			// Poll the opaque receipt. Unknown outcomes stop here; never resubmit.
			let job: ExportJob;
			let lastShown = -1;
			for (;;) {
				const receipt = (await request(
					resolved.secret,
					"GET",
					`export/${startedId}`,
				)) as {
					jobId: string;
					phase: string;
					progress: number;
					request: { options: ExportJob["options"] };
					output: null | { descriptor: string };
					error: string | null;
				};
				job = {
					id: receipt.jobId,
					status:
						receipt.phase === "reserved" ||
						receipt.phase === "dispatched" ||
						receipt.phase === "publishing"
							? "pending"
							: (receipt.phase as ExportJob["status"]),
					options: receipt.request.options,
					progress: receipt.progress,
					startedAt: 0,
					updatedAt: 0,
					cancelRequested: false,
					...(receipt.output
						? {
								outputPath: resolve(
									resolved.entry.projectPath,
									"exports",
									receipt.output.descriptor.slice(5),
								),
							}
						: {}),
					...(receipt.error ? { error: receipt.error } : {}),
				};
				if (job.status !== "pending" && job.status !== "running") break;
				const percent = Math.floor(job.progress * 100);
				if (percent !== lastShown) {
					// Progress on stderr keeps stdout a clean JSON result.
					process.stderr.write(`export ${startedId}: ${percent}%\n`);
					lastShown = percent;
				}
				await new Promise((wake) => setTimeout(wake, 1000));
			}

			if (job.status !== "completed" || job.outputPath === undefined) {
				throw new Error(
					`export ${startedId} ${job.status}: ${job.error ?? "no reason reported"}`,
				);
			}

			// The host only writes inside the project directory it owns; placing
			// the file where the caller asked is this process's job, because it
			// runs as the user and the HTTP surface deliberately does not.
			await deliverOutput(job.outputPath, out);
			process.stdout.write(
				JSON.stringify(
					{
						target: resolved.entry.id,
						jobId: job.id,
						status: job.status,
						format: job.options.format,
						...(job.options.videoQuantizer === undefined
							? {}
							: { videoQuantizer: job.options.videoQuantizer }),
						...(job.options.videoChroma === undefined
							? {}
							: { videoChroma: job.options.videoChroma }),
						hostPath: job.outputPath,
						...(out === undefined ? {} : { outputPath: resolve(out) }),
					},
					null,
					"\t",
				) + "\n",
			);
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
				if (
					outcome &&
					typeof outcome === "object" &&
					"accepted" in outcome &&
					outcome.accepted === false
				)
					throw new Error(
						"draft stage rejected; inspect field diagnostics before submitting another operation",
					);
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
			throw new Error(
				`Unknown command ${JSON.stringify(command)}. Pass subcommands as separate arguments; use --help for usage.`,
			);
	}
}

export { runCli };

function main(): void {
	runCli(process.argv.slice(2)).catch((error: unknown) => {
		process.stderr.write(
			`rocut: ${error instanceof Error ? error.message : String(error)}\n`,
		);
		if (error instanceof CliRequestError) {
			process.stderr.write(
				JSON.stringify({
					httpStatus: error.status,
					method: error.method,
					route: error.route,
					response: error.response,
				}) + "\n",
			);
		}
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

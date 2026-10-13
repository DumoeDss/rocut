import { randomBytes } from "node:crypto";
import { lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import * as wasm from "opencut-wasm";
import type {
	ProgrammaticSource,
	ProgrammaticResource,
} from "@opencut/editor-contracts";
import {
	createNativeExportRegistry,
	type NativeExportRecord,
	type NativeExportSource,
	type NativeExportRegistry,
} from "./host-export-native";
import type { ExportOptions } from "./host-export";
import { compileProgrammaticProject } from "./programmatic/engines/compile-project";
import { resolveEngineToolchain } from "./programmatic/engines/toolchain-resolver";
import { loadEngineToolchain } from "./programmatic/engines/toolchain";
import {
	hasHyperframesGraphProfile,
	HYPERFRAMES_GRAPH_PROFILE,
} from "./programmatic/hyperframes-graph-provenance";
import {
	loadProgrammaticResources,
	type ProgrammaticResourceStore,
} from "./programmatic/resources";
import { saveResourceBytes } from "./programmatic/resource-bytes";
import {
	nativeExportBytesSha256,
	readNativeExportFile,
} from "./native-export-readback";

export interface CompositionRequest {
	schemaVersion: 1;
	idempotencyKey: string;
	archive: { source: ProgrammaticSource; manifestSha256: string };
	options: ExportOptions;
}
export interface CompositionRecord {
	schemaVersion: 1;
	requestId: string;
	requestHash: string;
	archiveDigest: string;
	request: CompositionRequest;
	phase:
		| "reserved"
		| "compiling"
		| "compiled"
		| "exporting"
		| "failed"
		| "outcome-unknown";
	compiledSource: ProgrammaticSource | null;
	source: NativeExportSource | null;
	error: string | null;
	createdAt: number;
	updatedAt: number;
}
export type CompositionObservation = CompositionRecord & {
	exportReceipt?: NativeExportRecord;
};
type Surface = { write(chunk: string): unknown; flush?(): void };
type Result = {
	schemaVersion: 1;
	status: string;
	record?: CompositionRecord;
	error?: { code: string; message: string };
};
export class CompositionProductionError extends Error {
	constructor(
		readonly code: string,
		message = code,
	) {
		super(message);
	}
}
export function compositionProductionKernel(input: unknown): Result {
	const binding = (wasm as unknown as Record<string, unknown>)
		.resolveCompositionProductionJson;
	if (typeof binding !== "function")
		throw new CompositionProductionError(
			"composition-production-kernel-unavailable",
		);
	let result: Result;
	try {
		result = JSON.parse(binding(JSON.stringify(input)));
	} catch {
		throw new CompositionProductionError(
			"composition-production-kernel-failed",
		);
	}
	if (result?.schemaVersion !== 1 || typeof result.status !== "string")
		throw new CompositionProductionError(
			"composition-production-kernel-malformed",
		);
	if (result.status === "rejected")
		throw new CompositionProductionError(
			result.error?.code ?? "composition-production-rejected",
			result.error?.message,
		);
	return result;
}

/** Platform IO/orchestration only. Rust owns immutable request/source identity and transitions. */
export function createCompositionProductionRegistry(args: {
	projectDir: string;
	context: ProgrammaticResourceStore;
	enqueue<T>(operation: () => Promise<T>): Promise<T>;
	toolchainDirectory?: string;
	kernel?: typeof compositionProductionKernel;
	exportFactory?: typeof createNativeExportRegistry;
	compile?: typeof compileProgrammaticProject;
	now?: () => number;
}) {
	const kernel = args.kernel ?? compositionProductionKernel;
	const compile = args.compile ?? compileProgrammaticProject;
	const now = args.now ?? Date.now;
	const directory = join(args.projectDir, "composition-productions");
	const ledgerPath = join(directory, "requests.json");
	const surfaces = new Set<Surface>();
	const exports = new Map<string, NativeExportRegistry>();
	const attachments = new Map<Surface, Map<string, () => void>>();
	const active = new Map<string, AbortController>();
	const executions = new Map<string, Promise<void>>();
	let records: CompositionRecord[] = [];
	let loaded = false;
	let disposed = false;
	function resolve(input: unknown, statuses: string[]) {
		const result = kernel(input);
		if (
			result.schemaVersion !== 1 ||
			!statuses.includes(result.status) ||
			!result.record ||
			!/^[a-f0-9]{64}$/.test(result.record.requestId)
		)
			throw new CompositionProductionError(
				"composition-production-kernel-malformed",
			);
		return result;
	}
	async function safeDirectory() {
		await mkdir(directory, { recursive: true });
		if ((await lstat(directory)).isSymbolicLink())
			throw new CompositionProductionError(
				"composition-production-directory-redirected",
			);
	}
	async function persist(next: CompositionRecord[]) {
		await safeDirectory();
		const path = `${ledgerPath}.${randomBytes(12).toString("hex")}.pending`;
		try {
			const file = await open(path, "wx");
			try {
				await file.writeFile(
					JSON.stringify({ schemaVersion: 1, records: next }),
				);
				await file.sync();
			} finally {
				await file.close();
			}
			await rename(path, ledgerPath);
			records = next;
		} finally {
			await unlink(path).catch(() => undefined);
		}
	}
	async function put(record: CompositionRecord) {
		await persist([
			...records.filter((r) => r.requestId !== record.requestId),
			record,
		]);
		return record;
	}
	async function load() {
		if (loaded) return;
		let parsed: { schemaVersion: number; records: unknown[] };
		try {
			parsed = JSON.parse(
				new TextDecoder("utf-8", { fatal: true }).decode(
					await readNativeExportFile(ledgerPath, 32 * 1024 * 1024),
				),
			);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				loaded = true;
				return;
			}
			throw error;
		}
		if (
			parsed.schemaVersion !== 1 ||
			!Array.isArray(parsed.records) ||
			parsed.records.length > 10000
		)
			throw new CompositionProductionError(
				"composition-production-ledger-invalid",
			);
		const recovered = parsed.records.map(
			(record) =>
				resolve(
					{
						action: "transition",
						record,
						event: { kind: "recover" },
						now: now(),
					},
					["updated"],
				).record!,
		);
		if (
			new Set(recovered.map((r) => r.requestId)).size !== recovered.length ||
			new Set(recovered.map((r) => r.request.idempotencyKey)).size !==
				recovered.length
		)
			throw new CompositionProductionError(
				"composition-production-ledger-duplicate",
			);
		// Recovery is observation only: no compiler and no renderer dispatch, even from reserved.
		records = recovered;
		loaded = true;
		if (JSON.stringify(recovered) !== JSON.stringify(parsed.records))
			await persist(recovered);
	}
	async function transition(record: CompositionRecord, event: unknown) {
		return put(
			resolve({ action: "transition", record, event, now: now() }, ["updated"])
				.record!,
		);
	}
	function attachRegistry(
		surface: Surface,
		record: CompositionRecord,
		registry: NativeExportRegistry,
	) {
		const map = attachments.get(surface)!;
		if (map.has(record.requestId)) return;
		map.set(
			record.requestId,
			registry.attachSurface(
				{
					write(chunk) {
						const frame = JSON.parse(chunk.slice(6).trim()) as Record<
							string,
							unknown
						>;
						const command =
							frame.command === "export.start"
								? "composition.export.start"
								: "composition.export.cancel";
						surface.write(
							`data: ${JSON.stringify({ ...frame, command, requestId: record.requestId, ...(command === "composition.export.start" ? { source: record.source } : {}) })}\n\n`,
						);
						surface.flush?.();
					},
				},
				true,
			),
		);
	}
	async function registryFor(record: CompositionRecord) {
		if (!record.source)
			throw new CompositionProductionError(
				"composition-production-source-unavailable",
			);
		let registry = exports.get(record.requestId);
		if (!registry) {
			await safeDirectory();
			const scope = join(directory, record.requestId);
			await mkdir(scope, { recursive: true });
			if ((await lstat(scope)).isSymbolicLink())
				throw new CompositionProductionError(
					"composition-production-directory-redirected",
				);
			const source = structuredClone(record.source);
			registry = (args.exportFactory ?? createNativeExportRegistry)({
				projectDir: scope,
				enqueue: args.enqueue,
				source: async () => structuredClone(source),
			});
			exports.set(record.requestId, registry);
			for (const surface of surfaces) attachRegistry(surface, record, registry);
		}
		return registry;
	}
	async function observation(
		record: CompositionRecord,
	): Promise<CompositionObservation> {
		resolve({ action: "verify", record }, ["verified"]);
		if (record.phase !== "exporting" || !record.source)
			return structuredClone(record);
		const registry = await registryFor(record);
		const result = await registry.list();
		const receipts = result.jobs.filter(
			(job) => job.request.idempotencyKey === record.request.idempotencyKey,
		);
		if (receipts.length > 1)
			throw new CompositionProductionError(
				"composition-production-export-ambiguous",
			);
		if (!receipts.length && !active.has(record.requestId)) {
			return args.enqueue(async () => {
				const current = records.find((r) => r.requestId === record.requestId)!;
				return current.phase === "exporting"
					? transition(current, { kind: "dispatchUnknown" })
					: structuredClone(current);
			});
		}
		return {
			...structuredClone(record),
			...(receipts[0] ? { exportReceipt: receipts[0] } : {}),
		};
	}
	async function execute(
		record: CompositionRecord,
		controller: AbortController,
	) {
		try {
			const source = record.request.archive.source;
			// Preserve the established render/build resource namespaces and native budgets.
			await loadProgrammaticResources(
				args.context,
				source.resources ?? [],
				controller.signal,
			);
			if (source.build)
				await loadProgrammaticResources(
					args.context,
					[...source.build.inputs, source.build.toolchainLock],
					controller.signal,
				);
			let compiled = source;
			if (source.build) {
				const toolchain = resolveEngineToolchain({
					explicit: args.toolchainDirectory,
				});
				if (!toolchain.directory)
					throw new CompositionProductionError(
						"composition-production-toolchain-unavailable",
					);
				compiled = (
					await compile({
						action: "rebuild",
						input: source,
						context: args.context,
						toolchainDirectory: toolchain.directory,
						signal: controller.signal,
						enqueue: args.enqueue,
					})
				).source;
			}
			controller.signal.throwIfAborted();
			record = await args.enqueue(() =>
				transition(record, { kind: "compiled", source: compiled }),
			);
			const registry = await registryFor(record);
			controller.signal.throwIfAborted();
			record = await args.enqueue(() =>
				transition(record, { kind: "exportIntent" }),
			);
			await registry.start({
				schemaVersion: 1,
				projectId: record.source!.projectId,
				expectedRevision: 0,
				idempotencyKey: record.request.idempotencyKey,
				options: record.request.options,
			});
		} catch (error) {
			await args
				.enqueue(async () => {
					const current = records.find((r) => r.requestId === record.requestId);
					if (current && current.phase !== "exporting")
						await transition(current, {
							kind: "failed",
							error:
								error instanceof Error
									? error.message
									: "composition-production-failed",
						});
					// Export dispatch intent is permanent. Lack of a receipt cannot authorize a retry.
				})
				.catch(() => undefined);
		} finally {
			active.delete(record.requestId);
		}
	}
	return {
		async probe(input: {
			request?: unknown;
			engine?: "hyperframes" | "remotion";
		}) {
			const record =
				input.request !== undefined
					? resolve({ action: "admit", request: input.request, now: now() }, [
							"reserved",
						]).record
					: undefined;
			const source = record?.request.archive.source;
			const engine = source?.build?.engine ?? input.engine;
			let lock:
				| { resource: ProgrammaticResource; bytesBase64: string }
				| undefined;
			if (engine) {
				if (engine !== "remotion" && engine !== "hyperframes")
					throw new CompositionProductionError(
						"composition-production-engine-unsupported",
					);
				const resolved = resolveEngineToolchain({
					explicit: args.toolchainDirectory,
				});
				if (!resolved.directory)
					throw new CompositionProductionError(
						"composition-production-toolchain-unavailable",
					);
				const profiles =
					engine === "remotion" && source?.build
						? (["legacy-unpinned", "metadata-pinned-v1"] as const)
						: (["legacy-unpinned"] as const);
				for (const profile of profiles) {
					try {
						const toolchain = await loadEngineToolchain({
							directory: resolved.directory,
							engine,
							signal: new AbortController().signal,
							remotionMetadataProfile: profile,
							audioProfile:
								source && hasHyperframesGraphProfile(source)
									? HYPERFRAMES_GRAPH_PROFILE
									: undefined,
							audioTiming: source?.audio?.timing,
						});
						if (
							!source?.build ||
							toolchain.lock.resource.sha256 ===
								source.build.toolchainLock.sha256
						) {
							lock = {
								resource: toolchain.lock.resource,
								bytesBase64: Buffer.from(toolchain.lock.body).toString(
									"base64",
								),
							};
							break;
						}
					} catch {
						/* Probe another archived metadata profile, never compile/install. */
					}
				}
				if (!lock)
					throw new CompositionProductionError(
						"composition-production-toolchain-lock-conflict",
					);
			}
			const kernelAvailable =
				args.kernel !== undefined ||
				typeof (wasm as unknown as Record<string, unknown>)
					.resolveCompositionProductionJson === "function";
			return {
				schemaVersion: 1,
				available: !disposed && surfaces.size > 0 && kernelAvailable,
				scope: "single-fixed-composition-no-active-timeline",
				health: "configured-not-compile-browser-GPU-probed",
				includeAudio: "explicit-programmatic-native-audio-only",
				...(record ? { record } : {}),
				...(lock ? { lock } : {}),
			};
		},
		async stage(resource: ProgrammaticResource, bytes: Uint8Array) {
			if (disposed)
				throw new CompositionProductionError("composition-production-disposed");
			const body = bytes.buffer.slice(
				bytes.byteOffset,
				bytes.byteOffset + bytes.byteLength,
			) as ArrayBuffer;
			return args.enqueue(() =>
				saveResourceBytes(args.context, { resource, body }),
			);
		},
		attachSurface(surface: Surface, compatible: boolean) {
			if (!compatible || disposed) return () => {};
			surfaces.add(surface);
			attachments.set(surface, new Map());
			for (const record of records) {
				const registry = exports.get(record.requestId);
				if (registry) attachRegistry(surface, record, registry);
			}
			return () => {
				surfaces.delete(surface);
				for (const detach of attachments.get(surface)?.values() ?? []) detach();
				attachments.delete(surface);
			};
		},
		async start(request: unknown) {
			let executeRecord: CompositionRecord | undefined;
			const record = await args.enqueue(async () => {
				if (disposed)
					throw new CompositionProductionError(
						"composition-production-disposed",
					);
				await load();
				const key = (request as { idempotencyKey?: unknown } | null)
					?.idempotencyKey;
				const existing = records.find((r) => r.request.idempotencyKey === key);
				const admitted = resolve(
					{
						action: "admit",
						request,
						now: now(),
						...(existing ? { existing } : {}),
					},
					["reserved", "replay"],
				);
				if (admitted.status === "replay") return admitted.record!;
				if (!surfaces.size)
					throw new CompositionProductionError(
						"no-compatible-composition-export-surface",
					);
				await put(admitted.record!);
				executeRecord = await transition(admitted.record!, {
					kind: "compileIntent",
				});
				return executeRecord;
			});
			if (executeRecord) {
				const controller = new AbortController();
				active.set(record.requestId, controller);
				const execution = execute(executeRecord, controller).finally(() =>
					executions.delete(record.requestId),
				);
				executions.set(record.requestId, execution);
			}
			return observation(record);
		},
		async observe(requestId: string) {
			const record = await args.enqueue(async () => {
				await load();
				return records.find((r) => r.requestId === requestId);
			});
			return record ? observation(record) : undefined;
		},
		async request(key: string) {
			const record = await args.enqueue(async () => {
				await load();
				return records.find((r) => r.request.idempotencyKey === key);
			});
			return record ? observation(record) : undefined;
		},
		async exportRegistry(requestId: string) {
			const record = await args.enqueue(async () => {
				await load();
				return records.find((r) => r.requestId === requestId);
			});
			if (!record || record.phase !== "exporting")
				throw new CompositionProductionError(
					"composition-production-export-unavailable",
				);
			return registryFor(record);
		},
		async manifest(requestId: string) {
			const record = await args.enqueue(async () => {
				await load();
				return records.find((r) => r.requestId === requestId);
			});
			if (!record)
				throw new CompositionProductionError("composition-production-missing");
			const observed = await observation(record);
			if (
				!observed.exportReceipt ||
				observed.exportReceipt.phase !== "completed"
			)
				throw new CompositionProductionError(
					"composition-production-not-completed",
				);
			await (await registryFor(record)).manifest(observed.exportReceipt.jobId);
			const bytes = new TextEncoder().encode(
				JSON.stringify({
					schema: "composition-production-manifest/1",
					production: observed,
					export: observed.exportReceipt,
				}),
			);
			return {
				bytes,
				sha256: nativeExportBytesSha256(bytes),
				mime: "application/json",
			};
		},
		async artifact(requestId: string) {
			const record = await args.enqueue(async () => {
				await load();
				return records.find((r) => r.requestId === requestId);
			});
			if (!record)
				throw new CompositionProductionError("composition-production-missing");
			const observed = await observation(record);
			if (
				!observed.exportReceipt ||
				observed.exportReceipt.phase !== "completed"
			)
				throw new CompositionProductionError(
					"composition-production-not-completed",
				);
			return (await registryFor(record)).artifact(observed.exportReceipt.jobId);
		},
		async dispose() {
			disposed = true;
			for (const controller of active.values()) controller.abort();
			for (const surface of surfaces)
				for (const detach of attachments.get(surface)?.values() ?? []) detach();
			surfaces.clear();
			await Promise.all(executions.values());
		},
	};
}
export type CompositionProductionRegistry = ReturnType<
	typeof createCompositionProductionRegistry
>;

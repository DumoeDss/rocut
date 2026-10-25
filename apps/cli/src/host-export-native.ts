import { createHash, randomBytes } from "node:crypto";
import {
	link,
	lstat,
	mkdir,
	open,
	readFile,
	rename,
	unlink,
} from "node:fs/promises";
import { join } from "node:path";
import * as wasm from "opencut-wasm";
import type { ExportOptions } from "./host-export";
import { muxNativeExport } from "./host-export-mux";
import {
	readNativeExportFile,
	nativeExportManifestBytes,
	nativeExportBytesSha256,
	NativeExportReadbackError,
	NATIVE_EXPORT_ARTIFACT_LIMIT,
	NATIVE_EXPORT_LEDGER_LIMIT,
} from "./native-export-readback";

export interface NativeExportSource {
	projectId: string;
	revision: number;
	data: unknown;
}
export interface NativeExportRecord {
	schemaVersion: 1;
	jobId: string;
	request: {
		schemaVersion: 1;
		projectId: string;
		expectedRevision: number;
		idempotencyKey: string;
		options: ExportOptions;
	};
	requestHash: string;
	sourceRevision: number;
	sourceDigest: string;
	phase: string;
	cancelRequested: boolean;
	progress: number;
	output: null | { descriptor: string; bytes: number; sha256: string };
	publication: null | {
		output: { descriptor: string; bytes: number; sha256: string };
		stagingDescriptor: string;
	};
	error: null | string;
	createdAt: number;
	updatedAt: number;
}
type Surface = { write(chunk: string): unknown; flush?(): void };
type Result = {
	schemaVersion: number;
	status: string;
	record?: NativeExportRecord;
	output?: NonNullable<NativeExportRecord["output"]>;
	error?: { code: string; message: string };
};
export class NativeExportError extends Error {
	constructor(
		readonly code: string,
		message = code,
	) {
		super(message);
	}
}

/** Transport shape only. Admission, fingerprints, transitions and receipt checks stay in Rust. */
export function nativeExportKernel(input: unknown): Result {
	const binding = (wasm as unknown as Record<string, unknown>)
		.resolveNativeExportJobJson;
	if (typeof binding !== "function")
		throw new NativeExportError("native-export-kernel-unavailable");
	let result: Result;
	try {
		result = JSON.parse(binding(JSON.stringify(input)));
	} catch {
		throw new NativeExportError("native-export-kernel-failed");
	}
	if (
		!result ||
		result.schemaVersion !== 1 ||
		typeof result.status !== "string"
	)
		throw new NativeExportError("native-export-kernel-malformed");
	if (result.status === "rejected")
		throw new NativeExportError(
			result.error?.code ?? "native-export-rejected",
			result.error?.message,
		);
	return result;
}

export function createNativeExportRegistry(args: {
	projectDir: string;
	source(): Promise<NativeExportSource>;
	enqueue<T>(operation: () => Promise<T>): Promise<T>;
	kernel?: (input: unknown) => Result;
	now?: () => number;
	/** Controlled platform fault-injection seam; never supplies admission decisions. */
	onPublicationStep?(
		step:
			| "stage-written"
			| "intent-persisted"
			| "final-linked"
			| "completed-persisted",
		record: NativeExportRecord,
	): Promise<void>;
	/** Controlled read-race seam; never supplies bytes or receipt decisions. */
	onReadOpened?(kind: "ledger" | "artifact"): Promise<void>;
}) {
	const kernel = args.kernel ?? nativeExportKernel;
	const now = args.now ?? Date.now;
	const directory = join(args.projectDir, "exports");
	const ledger = join(directory, "native-export-jobs.json");
	const surfaces = new Set<Surface>();
	const targets = new Map<string, { surface: Surface; token: string }>();
	let records: NativeExportRecord[] = [];
	let loaded = false;
	let recoveryPending = false;
	function resolve(input: unknown, expected: string[]): Result {
		const result = kernel(input);
		if (result.schemaVersion !== 1 || !expected.includes(result.status))
			throw new NativeExportError("native-export-kernel-malformed");
		if (
			result.status !== "output-valid" &&
			(!result.record ||
				result.record.schemaVersion !== 1 ||
				typeof result.record.jobId !== "string" ||
				!result.record.request ||
				typeof result.record.request.idempotencyKey !== "string" ||
				typeof result.record.request.projectId !== "string" ||
				typeof result.record.requestHash !== "string" ||
				typeof result.record.sourceDigest !== "string" ||
				typeof result.record.phase !== "string" ||
				typeof result.record.progress !== "number" ||
				typeof result.record.cancelRequested !== "boolean")
		)
			throw new NativeExportError("native-export-kernel-malformed");
		return result;
	}
	async function safeDirectory() {
		await mkdir(directory, { recursive: true });
		if ((await lstat(directory)).isSymbolicLink())
			throw new NativeExportError("native-export-directory-redirected");
	}
	async function atomic(path: string, bytes: Uint8Array) {
		await safeDirectory();
		const staging = `${path}.${randomBytes(12).toString("hex")}.pending`;
		try {
			const file = await open(staging, "wx");
			try {
				await file.writeFile(bytes);
				await file.sync();
			} finally {
				await file.close();
			}
			await rename(staging, path);
		} finally {
			await unlink(staging).catch(() => undefined);
		}
	}
	async function persist(next: NativeExportRecord[]) {
		await atomic(
			ledger,
			new TextEncoder().encode(
				JSON.stringify({ schemaVersion: 1, records: next }),
			),
		);
		records = next;
	}
	async function put(record: NativeExportRecord) {
		await persist([
			...records.filter((item) => item.jobId !== record.jobId),
			record,
		]);
		return record;
	}
	async function load() {
		if (loaded) return;
		let saved: { schemaVersion: number; records: NativeExportRecord[] };
		try {
			saved = JSON.parse(await readFile(ledger, "utf8"));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				loaded = true;
				return;
			}
			throw error;
		}
		if (saved.schemaVersion !== 1 || !Array.isArray(saved.records))
			throw new NativeExportError("native-export-ledger-malformed");
		const recovered = saved.records.map(
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
		// Recovery is never dispatch: ambiguous execution remains outcome-unknown.
		records = recovered;
		recoveryPending =
			JSON.stringify(recovered) !== JSON.stringify(saved.records);
		loaded = true;
	}
	async function flushRecovery() {
		await reconcilePublications();
		if (recoveryPending) {
			await persist(records);
			recoveryPending = false;
		}
	}
	function filePath(descriptor: string) {
		const name = descriptor.slice(5);
		// Filesystem containment guard, not an export validator. Rust also validates descriptors.
		if (
			!descriptor.startsWith("file:") ||
			!/^[A-Za-z0-9_.-]+$/.test(name) ||
			name === "." ||
			name === ".."
		)
			throw new NativeExportError("native-export-path-invalid");
		return join(directory, name);
	}
	function validateBytes(record: NativeExportRecord, bytes: Uint8Array) {
		resolve(
			{
				action: "validateOutput",
				format: record.request.options.format,
				bytes: Array.from(bytes.subarray(0, 64)),
				byteLength: bytes.byteLength,
			},
			["output-valid"],
		);
	}
	function evidence(descriptor: string, bytes: Uint8Array) {
		return {
			descriptor,
			bytes: bytes.byteLength,
			sha256: createHash("sha256").update(bytes).digest("hex"),
		};
	}
	async function readEvidence(
		record: NativeExportRecord,
		pathDescriptor: string,
		outputDescriptor: string,
	) {
		let bytes: Uint8Array;
		try {
			if ((await lstat(filePath(pathDescriptor))).isSymbolicLink())
				throw new NativeExportError("native-export-file-redirected");
			bytes = await readFile(filePath(pathDescriptor));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
			throw error;
		}
		validateBytes(record, bytes);
		return evidence(outputDescriptor, bytes);
	}
	async function verifyCompletedFile(record: NativeExportRecord) {
		if (!record.output) return;
		const output = await readEvidence(
			record,
			record.output.descriptor,
			record.output.descriptor,
		);
		if (!output)
			throw new NativeExportError("native-export-output-unavailable");
		resolve({ action: "verify", record, output }, ["verified"]);
	}
	async function readBounded(
		path: string,
		limit: number,
		kind: "ledger" | "artifact",
	) {
		try {
			return await readNativeExportFile(
				path,
				limit,
				() => args.onReadOpened?.(kind) ?? Promise.resolve(),
			);
		} catch (error) {
			if (error instanceof NativeExportReadbackError)
				throw new NativeExportError(error.code);
			if ((error as NodeJS.ErrnoException).code === "ENOENT")
				throw new NativeExportError("native-export-output-unavailable");
			throw error;
		}
	}
	async function durableRecord(jobId: string) {
		if (!/^[a-f0-9]{36}$/.test(jobId))
			throw new NativeExportError("native-export-job-id-invalid");
		const bytes = await readBounded(
			ledger,
			NATIVE_EXPORT_LEDGER_LIMIT,
			"ledger",
		);
		let saved: { schemaVersion: number; records: NativeExportRecord[] };
		try {
			saved = JSON.parse(
				new TextDecoder("utf-8", { fatal: true }).decode(bytes),
			);
		} catch {
			throw new NativeExportError("native-export-ledger-malformed");
		}
		if (saved.schemaVersion !== 1 || !Array.isArray(saved.records))
			throw new NativeExportError("native-export-ledger-malformed");
		const matches = saved.records.filter((record) => record.jobId === jobId);
		if (matches.length !== 1)
			throw new NativeExportError("native-export-job-unavailable");
		const record = matches[0]!;
		resolve({ action: "verify", record }, ["verified"]);
		if (record.phase !== "completed" || !record.output || record.publication)
			throw new NativeExportError("native-export-not-completed");
		if (
			record.output.descriptor !==
			`file:${jobId}.${record.request.options.format}`
		)
			throw new NativeExportError("native-export-output-path-mismatch");
		return record;
	}
	async function completedReadback(jobId: string) {
		const record = await durableRecord(jobId);
		const source = await args.source();
		if (record.request.projectId !== source.projectId)
			throw new NativeExportError("native-export-project-mismatch");
		const manifest = nativeExportManifestBytes(record);
		const output = record.output!;
		if (output.bytes > NATIVE_EXPORT_ARTIFACT_LIMIT)
			throw new NativeExportError("native-export-read-limit");
		const bytes = await readBounded(
			filePath(output.descriptor),
			NATIVE_EXPORT_ARTIFACT_LIMIT,
			"artifact",
		);
		validateBytes(record, bytes);
		resolve(
			{ action: "verify", record, output: evidence(output.descriptor, bytes) },
			["verified"],
		);
		if (!manifest.equals(nativeExportManifestBytes(await durableRecord(jobId))))
			throw new NativeExportError("native-export-manifest-changed");
		return {
			manifest,
			bytes,
			sha256: output.sha256,
			mime:
				record.request.options.format === "webm" ? "video/webm" : "video/mp4",
		};
	}
	function confirmed(
		record: NativeExportRecord,
		output: NonNullable<NativeExportRecord["output"]>,
	) {
		return resolve(
			{
				action: "transition",
				record,
				event: { kind: "publicationConfirmed", output },
				now: now(),
			},
			["updated"],
		).record!;
	}
	async function publish(record: NativeExportRecord) {
		const intent = record.publication;
		if (!intent)
			throw new NativeExportError("native-export-publication-missing");
		const stage = await readEvidence(
			record,
			intent.stagingDescriptor,
			intent.output.descriptor,
		);
		const final = await readEvidence(
			record,
			intent.output.descriptor,
			intent.output.descriptor,
		);
		if (!stage && !final)
			throw new NativeExportError("native-export-publication-files-missing");
		// Each present file must independently match the frozen candidate in Rust.
		// Never replace an existing final, even when a different stage exists.
		if (stage) confirmed(record, stage);
		if (final) confirmed(record, final);
		if (!final) {
			await safeDirectory();
			try {
				await link(
					filePath(intent.stagingDescriptor),
					filePath(intent.output.descriptor),
				);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			}
			await args.onPublicationStep?.("final-linked", record);
		}
		const actualFinal = await readEvidence(
			record,
			intent.output.descriptor,
			intent.output.descriptor,
		);
		if (!actualFinal)
			throw new NativeExportError("native-export-publication-files-missing");
		const next = confirmed(record, actualFinal);
		resolve({ action: "verify", record: next, output: actualFinal }, [
			"verified",
		]);
		await put(next);
		targets.delete(record.jobId);
		await args.onPublicationStep?.("completed-persisted", next);
		// Cleanup is after the receipt's durable commit. Only remove this job's private stage.
		await unlink(filePath(intent.stagingDescriptor)).catch(() => undefined);
		return next;
	}
	async function reconcilePublications() {
		for (const record of [...records])
			if (record.publication) {
				try {
					await publish(record);
				} catch (error) {
					if (
						error instanceof NativeExportError &&
						[
							"native-export-kernel-unavailable",
							"native-export-kernel-failed",
							"native-export-kernel-malformed",
						].includes(error.code)
					)
						throw error;
					const current = records.find((item) => item.jobId === record.jobId)!;
					await transition(current, {
						kind: "dispatchUnknown",
						error: "publication-evidence-unavailable-or-conflicting",
					});
				}
			}
	}
	async function transition(
		record: NativeExportRecord,
		event: unknown,
		source?: NativeExportSource,
	) {
		return put(
			resolve(
				{
					action: "transition",
					record,
					event,
					now: now(),
					...(source ? { source } : {}),
				},
				["updated"],
			).record!,
		);
	}
	function send(surface: Surface, frame: unknown) {
		surface.write(`data: ${JSON.stringify(frame)}\n\n`);
		surface.flush?.();
	}
	function authenticate(jobId: string, token: string | undefined) {
		const owner = targets.get(jobId);
		if (!owner || owner.token !== token)
			throw new NativeExportError("native-export-surface-token-invalid");
		return owner;
	}
	const api = {
		async plan(request: unknown) {
			if (!surfaces.size)
				throw new NativeExportError("no-compatible-export-surface");
			const source = await args.source();
			if (
				(request as { projectId?: unknown } | null)?.projectId !==
				source.projectId
			)
				throw new NativeExportError("native-export-project-mismatch");
			const admitted = resolve(
				{
					action: "admit",
					request,
					source,
					jobId: randomBytes(18).toString("hex"),
					now: now(),
				},
				["reserved"],
			);
			resolve({ action: "verify", record: admitted.record }, ["verified"]);
			const record = admitted.record!;
			return {
				schema: "rocut/native-export-plan/1",
				request: record.request,
				requestHash: record.requestHash,
				sourceRevision: record.sourceRevision,
				sourceDigest: record.sourceDigest,
			};
		},
		async manifest(jobId: string) {
			return args.enqueue(async () => {
				const result = await completedReadback(jobId);
				return {
					bytes: result.manifest,
					sha256: nativeExportBytesSha256(result.manifest),
					mime: "application/json",
				};
			});
		},
		async artifact(jobId: string) {
			return args.enqueue(async () => {
				const result = await completedReadback(jobId);
				return {
					bytes: result.bytes,
					sha256: result.sha256,
					mime: result.mime,
				};
			});
		},
		attachSurface(surface: Surface, durable: boolean) {
			if (durable) surfaces.add(surface);
			return () => {
				surfaces.delete(surface);
				void args
					.enqueue(async () => {
						for (const [id, owner] of targets)
							if (owner.surface === surface) {
								const record = records.find((item) => item.jobId === id);
								if (record)
									await transition(record, {
										kind: "dispatchUnknown",
										error: "surface-disconnected",
									});
								targets.delete(id);
							}
					})
					.catch(() => undefined);
			};
		},
		async start(request: unknown) {
			const envelope = request as Record<string, unknown> | null;
			const guards = ["expectedSourceDigest", "expectedRequestHash"] as const;
			for (const guard of guards)
				if (
					envelope &&
					Object.hasOwn(envelope, guard) &&
					(typeof envelope[guard] !== "string" ||
						!/^[a-f0-9]{64}$/.test(envelope[guard] as string))
				)
					throw new NativeExportError("native-export-source-fence-invalid");
			const { expectedSourceDigest, expectedRequestHash, ...admissionRequest } =
				envelope ?? {};
			return args.enqueue(async () => {
				// Read-only recovery and replay lookup precede the current revision fence.
				const source = await args.source();
				const jobId = randomBytes(18).toString("hex");
				await load();
				const key = (admissionRequest as { idempotencyKey?: unknown } | null)
					?.idempotencyKey;
				const existing = records.find(
					(item) => item.request.idempotencyKey === key,
				);
				const admitted = resolve(
					{
						action: "admit",
						request: admissionRequest,
						source,
						jobId,
						now: now(),
						...(existing ? { existing } : {}),
					},
					["reserved", "replay"],
				);
				resolve({ action: "verify", record: admitted.record }, [
					"verified",
					"unverified",
				]);
				// Guard the Rust-admitted fixed identity, including replay identity, never a TS rehash.
				if (
					(expectedSourceDigest !== undefined &&
						expectedSourceDigest !== admitted.record!.sourceDigest) ||
					(expectedRequestHash !== undefined &&
						expectedRequestHash !== admitted.record!.requestHash)
				)
					throw new NativeExportError("native-export-source-fence-conflict");
				await flushRecovery();
				if (admitted.status === "replay")
					return records.find((item) => item.jobId === admitted.record!.jobId)!;
				const mux = admitted.record!.request.options.mux;
				const muxCancellation = new AbortController();
				const surface: Surface | undefined = mux
					? {
							write(chunk: string) {
								if (chunk.includes("export.cancel")) muxCancellation.abort();
							},
						}
					: (surfaces.values().next().value as Surface | undefined);
				if (!surface)
					throw new NativeExportError("no-compatible-export-surface");
				let record = await put(admitted.record!);
				const token = randomBytes(24).toString("hex");
				targets.set(jobId, { surface, token });
				// Persist dispatch intent before touching the stream; crash here must not resend.
				record = await transition(record, { kind: "dispatched" }, source);
				try {
					if (mux) {
						void Promise.resolve()
							.then(async () => {
								await api.report(jobId, token, {
									kind: "running",
									progress: 0,
								});
								const bytes = await muxNativeExport({
									options: record.request.options,
									signal: muxCancellation.signal,
									read: (id) =>
										args.enqueue(async () => {
											const value = await completedReadback(id);
											return {
												bytes: value.bytes,
												record: JSON.parse(
													value.manifest.toString("utf8"),
												) as NativeExportRecord,
											};
										}),
								});
								await api.complete(jobId, token, bytes);
							})
							.catch(async (error: unknown) => {
								await api
									.report(
										jobId,
										token,
										muxCancellation.signal.aborted
											? { kind: "cancelConfirmed" }
											: {
													kind: "failed",
													error:
														error instanceof Error
															? error.message
															: "Native mux failed",
												},
									)
									.catch(() => undefined);
							});
						return record;
					}
					send(surface, {
						command: "export.start",
						jobId,
						token,
						options: record.request.options,
						receipt: record,
					});
				} catch {
					record = await transition(record, {
						kind: "dispatchUnknown",
						error: "surface-write-unknown",
					});
					targets.delete(jobId);
				}
				return record;
			});
		},
		async get(jobId: string) {
			return args.enqueue(async () => {
				await load();
				await flushRecovery();
				const record = records.find((item) => item.jobId === jobId);
				if (!record) return undefined;
				resolve({ action: "verify", record }, ["verified", "unverified"]);
				await verifyCompletedFile(record);
				return record;
			});
		},
		async list() {
			return args.enqueue(async () => {
				await load();
				await flushRecovery();
				for (const record of records) await verifyCompletedFile(record);
				return {
					protocol: {
						version: 4,
						nativeExport: true,
						nativeExportPlan: true,
						nativeExportReadback: true,
						nativeExportSourceFence: true,
						nativeExportMux: true,
						videoQuantizer: true,
						videoChroma: ["420", "444"],
					},
					surfaces: surfaces.size,
					jobs: records,
				};
			});
		},
		async report(jobId: string, token: string | undefined, event: unknown) {
			return args.enqueue(async () => {
				authenticate(jobId, token);
				const record = records.find((item) => item.jobId === jobId);
				if (!record) return undefined;
				return transition(record, event, await args.source());
			});
		},
		async cancel(jobId: string) {
			return args.enqueue(async () => {
				await load();
				// Persist intent before any pending file reconciliation; completion must retain this history.
				const record = records.find((item) => item.jobId === jobId);
				if (!record) return undefined;
				const next = await transition(record, { kind: "cancelRequest" });
				const owner = targets.get(jobId);
				if (owner)
					try {
						send(owner.surface, { command: "export.cancel", jobId });
					} catch {
						return transition(next, {
							kind: "dispatchUnknown",
							error: "cancel-delivery-unknown",
						});
					}
				return next;
			});
		},
		async complete(
			jobId: string,
			token: string | undefined,
			bytes: Uint8Array,
		) {
			return args.enqueue(async () => {
				authenticate(jobId, token);
				const record = records.find((item) => item.jobId === jobId);
				if (!record) return undefined;
				const source = await args.source();
				const descriptor = `file:${jobId}.${record.request.options.format}`;
				validateBytes(record, bytes);
				const candidate = evidence(descriptor, bytes);
				const stagingDescriptor = `file:${jobId}.${record.request.options.format}.staged`;
				// Rust freezes the original candidate and source BEFORE any output IO.
				const publishing = resolve(
					{
						action: "transition",
						record,
						source,
						event: {
							kind: "publicationStart",
							output: candidate,
							stagingDescriptor,
						},
						now: now(),
					},
					["updated"],
				).record!;
				resolve({ action: "verify", record: publishing }, ["verified"]);
				await safeDirectory();
				try {
					await put(publishing);
					await args.onPublicationStep?.("intent-persisted", publishing);
					const stage = await open(filePath(stagingDescriptor), "wx");
					try {
						await stage.writeFile(bytes);
						await stage.sync();
					} finally {
						await stage.close();
					}
					await args.onPublicationStep?.("stage-written", publishing);
					const actualStage = await readEvidence(
						publishing,
						stagingDescriptor,
						descriptor,
					);
					if (!actualStage)
						throw new NativeExportError(
							"native-export-publication-files-missing",
						);
					confirmed(publishing, actualStage); // Candidate hash/bytes comparison, not self-verifying new evidence.
					return await publish(publishing);
				} catch (error) {
					if (
						error instanceof NativeExportError &&
						[
							"native-export-kernel-unavailable",
							"native-export-kernel-failed",
							"native-export-kernel-malformed",
						].includes(error.code)
					)
						throw error;
					const current = records.find((item) => item.jobId === jobId)!;
					// Let Rust retain any publication intent; never replace it with a synthetic completion.
					await transition(current, {
						kind: "dispatchUnknown",
						error: "publication-interrupted-or-evidence-conflicting",
					}).catch(() => undefined);
					throw error;
				}
			});
		},
	};
	return api;
}
export type NativeExportRegistry = ReturnType<
	typeof createNativeExportRegistry
>;

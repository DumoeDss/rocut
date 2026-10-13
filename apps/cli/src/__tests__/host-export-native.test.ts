import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rm,
	writeFile,
	copyFile,
	unlink,
} from "node:fs/promises";
import { join } from "node:path";
import {
	createNativeExportRegistry,
	type NativeExportRecord,
	NativeExportError,
} from "../host-export-native";

// Platform tests use a controlled kernel seam; canonical business admission is tested in Rust.
function kernel(input: any): any {
	if (input.action === "admit") {
		if (input.existing)
			return { schemaVersion: 1, status: "replay", record: input.existing };
		if (input.request.expectedRevision !== input.source.revision)
			throw new NativeExportError("revision-conflict");
		return {
			schemaVersion: 1,
			status: "reserved",
			record: {
				schemaVersion: 1,
				jobId: input.jobId,
				request: input.request,
				requestHash: "request",
				sourceRevision: input.source.revision,
				sourceDigest: "source",
				phase: "reserved",
				cancelRequested: false,
				progress: 0,
				output: null,
				publication: null,
				error: null,
				createdAt: input.now,
				updatedAt: input.now,
			},
		};
	}
	if (input.action === "validateOutput") {
		if (input.byteLength < 32 || input.bytes[0] !== 0x1a)
			throw new NativeExportError("invalid-output");
		return { schemaVersion: 1, status: "output-valid" };
	}
	if (input.action === "verify") {
		if (
			input.output &&
			JSON.stringify(input.record.output) !== JSON.stringify(input.output)
		)
			throw new NativeExportError("output-mismatch");
		return { schemaVersion: 1, status: "verified", record: input.record };
	}
	const record: NativeExportRecord = structuredClone(input.record);
	switch (input.event.kind) {
		case "recover":
			if (["reserved", "dispatched", "running"].includes(record.phase))
				record.phase = "outcome-unknown";
			break;
		case "cancelRequest":
			record.cancelRequested = true;
			break;
		case "cancelConfirmed":
			record.phase = "cancelled";
			break;
		case "dispatchUnknown":
			record.phase = "outcome-unknown";
			break;
		case "complete":
			record.phase = "completed";
			record.output = input.event.output;
			break;
		case "publicationStart":
			record.phase = "publishing";
			record.publication = {
				output: input.event.output,
				stagingDescriptor: input.event.stagingDescriptor,
			};
			break;
		case "publicationConfirmed":
			if (
				!record.publication ||
				JSON.stringify(record.publication.output) !==
					JSON.stringify(input.event.output)
			)
				throw new NativeExportError("output-conflict");
			record.phase = "completed";
			record.output = record.publication.output;
			record.publication = null;
			break;
		default:
			record.phase = input.event.kind;
	}
	return { schemaVersion: 1, status: "updated", record };
}

async function fixture(run: (dir: string) => Promise<void>) {
	await mkdir("C:/tmps", { recursive: true });
	const directory = await mkdtemp("C:/tmps/rocut-native-export-platform-");
	try {
		await run(directory);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}
const request = {
	schemaVersion: 1,
	projectId: "project",
	expectedRevision: 7,
	idempotencyKey: "key",
	options: { format: "webm", quality: "high" },
};

test("publication kernel trap or malformed response cannot write stage or mutate ledger", () =>
	fixture(async (projectDir) => {
		for (const mode of ["trap", "malformed"]) {
			let command: any;
			const registry = createNativeExportRegistry({
				projectDir,
				source: async () => ({ projectId: "project", revision: 7, data: {} }),
				enqueue: (operation) => operation(),
				kernel: (input) => {
					if ((input as any).event?.kind === "publicationStart") {
						if (mode === "trap") throw new Error("publication trap");
						return { schemaVersion: 1, status: "updated" };
					}
					return kernel(input);
				},
			});
			registry.attachSurface(
				{
					write: (chunk) => {
						command = JSON.parse(chunk.slice(6));
					},
				},
				true,
			);
			const started = await registry.start({
				...request,
				idempotencyKey: mode,
			});
			const ledger = join(projectDir, "exports/native-export-jobs.json");
			const before = await readFile(ledger, "utf8");
			const bytes = new Uint8Array(32);
			bytes.set([0x1a, 0x45, 0xdf, 0xa3]);
			await expect(
				registry.complete(started.jobId, command.token, bytes),
			).rejects.toThrow();
			expect(await readFile(ledger, "utf8")).toBe(before);
			expect(await readdir(join(projectDir, "exports"))).toEqual([
				"native-export-jobs.json",
			]);
		}
	}));

for (const state of [
	"none",
	"stage",
	"final",
	"both",
	"bad-stage",
	"bad-final",
	"bad-final-with-stage",
	"bad-stage-with-final",
] as const) {
	test(`publication restart reconciles ${state} without another encode or overwrite`, () =>
		fixture(async (projectDir) => {
			let command: any;
			const source = async () => ({
				projectId: "project",
				revision: 7,
				data: {},
			});
			const enqueue = <T>(operation: () => Promise<T>) => operation();
			const registry = createNativeExportRegistry({
				projectDir,
				source,
				enqueue,
				kernel,
				onPublicationStep: async (step) => {
					if (step === "stage-written")
						throw new Error("simulated interruption");
				},
			});
			registry.attachSurface(
				{
					write: (chunk) => {
						command = JSON.parse(chunk.slice(6));
					},
				},
				true,
			);
			const job = await registry.start(request);
			const bytes = new Uint8Array(32);
			bytes.set([0x1a, 0x45, 0xdf, 0xa3]);
			await expect(
				registry.complete(job.jobId, command.token, bytes),
			).rejects.toThrow("simulated interruption");
			const stage = join(projectDir, "exports", `${job.jobId}.webm.staged`);
			const final = join(projectDir, "exports", `${job.jobId}.webm`);
			const original = await readFile(stage);
			if (
				[
					"final",
					"both",
					"bad-final",
					"bad-final-with-stage",
					"bad-stage-with-final",
				].includes(state)
			)
				await copyFile(stage, final);
			if (["none", "final", "bad-final"].includes(state)) await unlink(stage);
			const corrupted = new Uint8Array(bytes);
			corrupted[15] = 99;
			if (state === "bad-stage" || state === "bad-stage-with-final")
				await writeFile(stage, corrupted);
			if (state === "bad-final" || state === "bad-final-with-stage")
				await writeFile(final, corrupted);
			const restarted = createNativeExportRegistry({
				projectDir,
				source: async () => ({ projectId: "project", revision: 8, data: {} }),
				enqueue,
				kernel,
			});
			let newFrames = 0;
			restarted.attachSurface(
				{
					write: () => {
						newFrames++;
					},
				},
				true,
			);
			const recovered = await restarted.get(job.jobId);
			const succeeds = ["stage", "final", "both"].includes(state);
			expect(recovered?.phase).toBe(succeeds ? "completed" : "outcome-unknown");
			expect(recovered?.output === null).toBe(!succeeds);
			expect(newFrames).toBe(0);
			const replay = await restarted.start(request);
			expect(replay.jobId).toBe(job.jobId);
			expect(newFrames).toBe(0);
			if (succeeds) expect(await readFile(final)).toEqual(original);
			if (state === "bad-final" || state === "bad-final-with-stage")
				expect(await readFile(final)).toEqual(Buffer.from(corrupted));
			const ledger = JSON.parse(
				await readFile(
					join(projectDir, "exports/native-export-jobs.json"),
					"utf8",
				),
			);
			expect(ledger.records[0].phase).toBe(recovered?.phase);
			expect(ledger.records[0].publication === null).toBe(succeeds);
		}));
}

test("actual staged bytes cannot replace the validated candidate hash", () =>
	fixture(async (projectDir) => {
		let command: any;
		const registry = createNativeExportRegistry({
			projectDir,
			source: async () => ({ projectId: "project", revision: 7, data: {} }),
			enqueue: (operation) => operation(),
			kernel,
			onPublicationStep: async (step, record) => {
				if (step === "stage-written") {
					const path = join(
						projectDir,
						"exports",
						record.publication!.stagingDescriptor.slice(5),
					);
					const altered = await readFile(path);
					altered[12] = 23;
					await writeFile(path, altered);
				}
			},
		});
		registry.attachSurface(
			{
				write: (chunk) => {
					command = JSON.parse(chunk.slice(6));
				},
			},
			true,
		);
		const job = await registry.start(request);
		const bytes = new Uint8Array(32);
		bytes.set([0x1a, 0x45, 0xdf, 0xa3]);
		await expect(
			registry.complete(job.jobId, command.token, bytes),
		).rejects.toThrow("output-conflict");
		expect((await registry.get(job.jobId))?.phase).toBe("outcome-unknown");
		const persisted = JSON.parse(
			await readFile(
				join(projectDir, "exports/native-export-jobs.json"),
				"utf8",
			),
		).records[0];
		expect(persisted.publication.output.bytes).toBe(32);
		expect(persisted.publication.output.sha256).toBe(
			createHash("sha256").update(bytes).digest("hex"),
		);
		expect(await readdir(join(projectDir, "exports"))).not.toContain(
			`${job.jobId}.webm`,
		);
	}));

test("publication reconciliation keeps durable cancellation history instead of claiming cancelled", () =>
	fixture(async (projectDir) => {
		let command: any;
		const source = async () => ({
			projectId: "project",
			revision: 7,
			data: {},
		});
		const enqueue = <T>(operation: () => Promise<T>) => operation();
		const registry = createNativeExportRegistry({
			projectDir,
			source,
			enqueue,
			kernel,
			onPublicationStep: async (step) => {
				if (step === "stage-written") throw new Error("pending publication");
			},
		});
		registry.attachSurface(
			{
				write: (chunk) => {
					command = JSON.parse(chunk.slice(6));
				},
			},
			true,
		);
		const job = await registry.start(request);
		const bytes = new Uint8Array(32);
		bytes.set([0x1a, 0x45, 0xdf, 0xa3]);
		await expect(
			registry.complete(job.jobId, command.token, bytes),
		).rejects.toThrow("pending publication");
		await registry.cancel(job.jobId);
		const reopened = createNativeExportRegistry({
			projectDir,
			source,
			enqueue,
			kernel,
		});
		const completed = await reopened.get(job.jobId);
		expect(completed?.phase).toBe("completed");
		expect(completed?.cancelRequested).toBe(true);
	}));

test("intent commits the candidate before stage IO and missing files remain unknown", () =>
	fixture(async (projectDir) => {
		let command: any;
		const source = async () => ({
			projectId: "project",
			revision: 7,
			data: {},
		});
		const enqueue = <T>(operation: () => Promise<T>) => operation();
		const registry = createNativeExportRegistry({
			projectDir,
			source,
			enqueue,
			kernel,
			onPublicationStep: async (step) => {
				if (step === "intent-persisted") throw new Error("crash before stage");
			},
		});
		registry.attachSurface(
			{
				write: (chunk) => {
					command = JSON.parse(chunk.slice(6));
				},
			},
			true,
		);
		const job = await registry.start(request);
		const bytes = new Uint8Array(32);
		bytes.set([0x1a, 0x45, 0xdf, 0xa3]);
		await expect(
			registry.complete(job.jobId, command.token, bytes),
		).rejects.toThrow("crash before stage");
		expect(await readdir(join(projectDir, "exports"))).toEqual([
			"native-export-jobs.json",
		]);
		const reopened = createNativeExportRegistry({
			projectDir,
			source,
			enqueue,
			kernel,
		});
		const recovered = await reopened.get(job.jobId);
		expect(recovered?.phase).toBe("outcome-unknown");
		expect(recovered?.publication?.output.bytes).toBe(32);
		expect(recovered?.output).toBeNull();
	}));

test("crash after final link preserves candidate intent until restart proves the receipt", () =>
	fixture(async (projectDir) => {
		let command: any;
		const source = async () => ({
			projectId: "project",
			revision: 7,
			data: {},
		});
		const enqueue = <T>(operation: () => Promise<T>) => operation();
		const registry = createNativeExportRegistry({
			projectDir,
			source,
			enqueue,
			kernel,
			onPublicationStep: async (step) => {
				if (step === "final-linked") throw new Error("publication interrupted");
			},
		});
		registry.attachSurface(
			{
				write: (chunk) => {
					command = JSON.parse(chunk.slice(6));
				},
			},
			true,
		);
		const job = await registry.start(request);
		const bytes = new Uint8Array(32);
		bytes.set([0x1a, 0x45, 0xdf, 0xa3]);
		await expect(
			registry.complete(job.jobId, command.token, bytes),
		).rejects.toThrow("publication interrupted");
		const durable = JSON.parse(
			await readFile(
				join(projectDir, "exports/native-export-jobs.json"),
				"utf8",
			),
		).records[0];
		expect(durable.output).toBeNull();
		expect(durable.phase).not.toBe("completed");
		expect(durable.publication).not.toBeNull();
		const reopened = createNativeExportRegistry({
			projectDir,
			source,
			enqueue,
			kernel,
		});
		expect((await reopened.get(job.jobId))?.phase).toBe("completed");
	}));

test("single owner, persisted-before-dispatch, durable intent and replay across changed source", () =>
	fixture(async (projectDir) => {
		let revision = 7;
		const source = async () => ({ projectId: "project", revision, data: {} });
		const enqueue = <T>(operation: () => Promise<T>) => operation();
		const registry = createNativeExportRegistry({
			projectDir,
			source,
			enqueue,
			kernel,
		});
		const first: any[] = [],
			second: any[] = [];
		registry.attachSurface(
			{ write: (chunk) => first.push(JSON.parse(chunk.slice(6))) },
			true,
		);
		registry.attachSurface(
			{ write: (chunk) => second.push(JSON.parse(chunk.slice(6))) },
			true,
		);
		const started = await registry.start(request);
		expect(first).toHaveLength(1);
		expect(second).toHaveLength(0);
		const saved = JSON.parse(
			await readFile(
				join(projectDir, "exports/native-export-jobs.json"),
				"utf8",
			),
		);
		expect(saved.records[0].phase).toBe("dispatched");
		await expect(
			registry.report(started.jobId, "wrong", { kind: "running" }),
		).rejects.toThrow("surface-token");
		const cancelled = await registry.cancel(started.jobId);
		expect(cancelled?.cancelRequested).toBe(true);
		expect(cancelled?.phase).toBe("dispatched");
		revision = 8;
		const replay = await registry.start(request);
		expect(replay.jobId).toBe(started.jobId);
		expect(first).toHaveLength(2);
		const reopened = createNativeExportRegistry({
			projectDir,
			source,
			enqueue,
			kernel,
		});
		const recovered = await reopened.start(request);
		expect(recovered.phase).toBe("outcome-unknown");
		expect(first).toHaveLength(2);
	}));

test("bad kernel fails before ledger writes or surface dispatch", () =>
	fixture(async (projectDir) => {
		for (const broken of [
			() => {
				throw new Error("missing/trap");
			},
			() => ({ schemaVersion: 1, status: "reserved" }),
		]) {
			const registry = createNativeExportRegistry({
				projectDir,
				source: async () => ({ projectId: "project", revision: 7, data: {} }),
				enqueue: (operation) => operation(),
				kernel: broken,
			});
			let frames = 0;
			registry.attachSurface(
				{
					write: () => {
						frames++;
					},
				},
				true,
			);
			await expect(registry.start(request)).rejects.toThrow();
			expect(frames).toBe(0);
			expect(await readdir(projectDir)).toEqual([]);
		}
	}));

test("published real bytes are hashed, receipt verified, and tampering fails readback", () =>
	fixture(async (projectDir) => {
		const registry = createNativeExportRegistry({
			projectDir,
			source: async () => ({ projectId: "project", revision: 7, data: {} }),
			enqueue: (operation) => operation(),
			kernel,
		});
		let command: any;
		registry.attachSurface(
			{
				write: (chunk) => {
					command = JSON.parse(chunk.slice(6));
				},
			},
			true,
		);
		const job = await registry.start(request);
		await expect(
			registry.complete(job.jobId, command.token, new Uint8Array([1])),
		).rejects.toThrow("invalid-output");
		const bytes = new Uint8Array(32);
		bytes.set([0x1a, 0x45, 0xdf, 0xa3]);
		const complete = await registry.complete(job.jobId, command.token, bytes);
		expect(complete?.phase).toBe("completed");
		expect(complete?.output?.sha256).toHaveLength(64);
		expect((await registry.get(job.jobId))?.phase).toBe("completed");
		bytes[10] = 42;
		await writeFile(
			join(projectDir, "exports", complete!.output!.descriptor.slice(5)),
			bytes,
		);
		await expect(registry.get(job.jobId)).rejects.toThrow("output-mismatch");
	}));

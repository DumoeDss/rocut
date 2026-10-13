import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { InMemoryProjectStore } from "@opencut/editor-ports/in-memory";
import {
	createCompositionProductionRegistry,
	CompositionProductionError,
	type CompositionRequest,
	type CompositionRecord,
} from "../composition-production";
import {
	createNativeExportRegistry,
	NativeExportError,
} from "../host-export-native";
import { describeResource } from "../programmatic/resource-bytes";
import { resourceDigest } from "../programmatic/resources";
import { parseCompileInput } from "../programmatic/engines/build-source";

const executable = process.env.ROCUT_COMPOSITION_KERNEL_BINARY;
function kernel(kind: "composition" | "export", input: unknown): any {
	if (!executable) throw Error("Explicit native kernel test binary missing");
	const result = spawnSync(executable, [], {
		input: JSON.stringify({ kernel: kind, input }),
		encoding: "utf8",
		timeout: 5000,
		windowsHide: true,
	});
	if (result.status !== 0) throw Error("Native kernel test binary failed");
	const parsed = JSON.parse(result.stdout);
	if (parsed.status === "rejected")
		throw kind === "composition"
			? new CompositionProductionError(parsed.error.code, parsed.error.message)
			: new NativeExportError(parsed.error.code, parsed.error.message);
	return parsed;
}
const source = {
	version: 1 as const,
	runtime: "html-document" as const,
	code: "<!doctype html><html><body>Fixed</body></html>",
	width: 64,
	height: 32,
	frameRate: { numerator: 30, denominator: 1 },
	durationFrames: 30,
	seed: 0,
};
const request = (): CompositionRequest => ({
	schemaVersion: 1,
	idempotencyKey: "composition-operation",
	archive: { source, manifestSha256: "a".repeat(64) },
	options: { format: "mp4", quality: "high" },
});
async function fixture(
	run: (f: Awaited<ReturnType<typeof setup>>) => Promise<void>,
) {
	const root = await mkdtemp("C:/tmps/rocut-composition-fixture-");
	try {
		await run(await setup(root));
	} finally {
		const target = resolve(root);
		if (
			!relative(resolve("C:/tmps"), target).startsWith(
				"rocut-composition-fixture-",
			)
		)
			throw Error("Unsafe fixture cleanup");
		await rm(target, { recursive: true, force: true });
	}
}
async function setup(root: string) {
	const store = new InMemoryProjectStore();
	let projectWrites = 0,
		compilerCalls = 0;
	const compilerArgs: any[] = [];
	store.save = async () => {
		projectWrites++;
		throw Error("Timeline mutation forbidden");
	};
	const context = { store, projectId: "existing-project" };
	const frames: any[] = [];
	let queue: Promise<unknown> = Promise.resolve();
	const options = {
		projectDir: root,
		context,
		enqueue: <T>(task: () => Promise<T>): Promise<T> => {
			const result = queue.then(task);
			queue = result.catch(() => undefined);
			return result;
		},
		kernel: (input: unknown) => kernel("composition", input),
		exportFactory: (args: Parameters<typeof createNativeExportRegistry>[0]) =>
			createNativeExportRegistry({
				...args,
				kernel: (input: unknown) => kernel("export", input),
			}),
		toolchainDirectory: join(root, "controlled-toolchain"),
		compile: async (args: any) => {
			compilerCalls++;
			compilerArgs.push(args);
			return { source: args.input, reusedDocument: true };
		},
	};
	const registry = createCompositionProductionRegistry(options);
	const attach = () =>
		registry.attachSurface(
			{ write: (chunk) => frames.push(JSON.parse(chunk.slice(6).trim())) },
			true,
		);
	return {
		root,
		store,
		context,
		registry,
		options,
		frames,
		attach,
		compilerArgs,
		projectWrites: () => projectWrites,
		compilerCalls: () => compilerCalls,
	};
}
async function exporting(
	f: Awaited<ReturnType<typeof setup>>,
	started: CompositionRecord,
) {
	for (let i = 0; i < 100; i++) {
		const current = await f.registry.observe(started.requestId);
		if (current?.exportReceipt && current.exportReceipt.phase !== "reserved")
			return current;
		if (current?.phase === "failed") throw Error(current.error ?? "Failed");
		await new Promise((done) => setTimeout(done, 10));
	}
	throw Error("No independent export dispatch");
}

test.skipIf(!executable)(
	"fixed document dispatches isolated source and only actual codec bytes complete production",
	async () =>
		fixture(async (f) => {
			f.attach();
			const started = await f.registry.start(request());
			expect(started.phase).toBe("compiling");
			await expect(f.registry.artifact(started.requestId)).rejects.toThrow(
				"not-completed",
			);
			const observed = await exporting(f, started);
			const frame = f.frames[0];
			expect(frame.command).toBe("composition.export.start");
			expect(frame.requestId).toBe(started.requestId);
			expect(frame.source.projectId).toBe("composition:" + started.requestId);
			expect(frame.source.data.scenes).toHaveLength(1);
			expect(
				frame.source.data.scenes[0].tracks.overlay[0].elements[0].programmatic,
			).toEqual(source);
			expect(frame.receipt).toEqual(observed.exportReceipt);
			const registry = await f.registry.exportRegistry(started.requestId);
			await expect(
				registry.complete(frame.jobId, frame.token, new Uint8Array(32)),
			).rejects.toThrow();
			const bytes = Buffer.alloc(32);
			bytes.writeUInt32BE(24);
			bytes.write("ftyp", 4);
			bytes.write("isom", 8);
			await registry.complete(frame.jobId, frame.token, bytes);
			const complete = await f.registry.observe(started.requestId);
			expect(complete?.phase).toBe("exporting");
			expect(complete?.exportReceipt?.phase).toBe("completed");
			const manifest = JSON.parse(
				Buffer.from(
					(await f.registry.manifest(started.requestId)).bytes,
				).toString("utf8"),
			);
			expect(manifest.production).toEqual(complete);
			expect(manifest.export).toEqual(complete?.exportReceipt);
			expect(
				Buffer.from((await f.registry.artifact(started.requestId)).bytes),
			).toEqual(bytes);
			expect(f.projectWrites()).toBe(0);
			expect(f.compilerCalls()).toBe(0);
			await f.registry.start(request());
			expect(f.frames).toHaveLength(1);
		}),
);

test.skipIf(!executable)(
	"ordinary attached surfaces are not independent composition render capability",
	async () =>
		fixture(async (f) => {
			f.registry.attachSurface(
				{
					write: () => {
						throw Error("Wrong surface");
					},
				},
				false,
			);
			expect((await f.registry.probe({ request: request() })).available).toBe(
				false,
			);
			await expect(f.registry.start(request())).rejects.toThrow(
				"no-compatible-composition",
			);
			expect(
				await f.registry.request(request().idempotencyKey),
			).toBeUndefined();
		}),
);

test.skipIf(!executable)(
	"recovered compilation intent is unknown and cannot rebuild or redispatch",
	async () =>
		fixture(async (f) => {
			const admitted = kernel("composition", {
				action: "admit",
				request: request(),
				now: 10,
			}).record;
			const compiling = kernel("composition", {
				action: "transition",
				record: admitted,
				event: { kind: "compileIntent" },
				now: 11,
			}).record;
			await mkdir(join(f.root, "composition-productions"));
			await writeFile(
				join(f.root, "composition-productions", "requests.json"),
				JSON.stringify({ schemaVersion: 1, records: [compiling] }),
				"utf8",
			);
			f.attach();
			const recovered = await f.registry.request(request().idempotencyKey);
			expect(recovered?.phase).toBe("outcome-unknown");
			expect((await f.registry.start(request())).phase).toBe("outcome-unknown");
			expect(f.frames).toHaveLength(0);
			expect(f.compilerCalls()).toBe(0);
			expect(f.projectWrites()).toBe(0);
		}),
);

test.skipIf(!executable)(
	"restart observes dispatched job without compiling or rerendering",
	async () =>
		fixture(async (f) => {
			f.attach();
			const started = await f.registry.start(request());
			await exporting(f, started);
			const restarted = createCompositionProductionRegistry(f.options);
			const frames: unknown[] = [];
			restarted.attachSurface({ write: (chunk) => frames.push(chunk) }, true);
			const recovered = await restarted.request(request().idempotencyKey);
			expect(recovered?.exportReceipt?.phase).toBe("outcome-unknown");
			await restarted.start(request());
			expect(frames).toHaveLength(0);
			await expect(restarted.artifact(started.requestId)).rejects.toThrow(
				"not-completed",
			);
			expect(f.compilerCalls()).toBe(0);
			expect(f.projectWrites()).toBe(0);
		}),
);

test.skipIf(!executable)(
	"CAS stage verifies descriptor bytes and never saves timeline",
	async () =>
		fixture(async (f) => {
			const body = new TextEncoder().encode(
				"<!doctype html><html>Fixed</html>",
			);
			const resource = describeResource(
				{ id: "doc.html", kind: "document", mimeType: "text/html" },
				body.length,
				resourceDigest(body.buffer),
			);
			expect((await f.registry.stage(resource, body)).reused).toBe(false);
			expect((await f.registry.stage(resource, body)).reused).toBe(true);
			await expect(
				f.registry.stage(resource, new Uint8Array(body.length)),
			).rejects.toThrow("integrity");
			expect(f.projectWrites()).toBe(0);
		}),
);

test.skipIf(!executable)(
	"idempotency mutation and ledger source substitution are rejected",
	async () =>
		fixture(async (f) => {
			f.attach();
			const started = await f.registry.start(request());
			await exporting(f, started);
			await expect(
				f.registry.start({
					...request(),
					archive: { source, manifestSha256: "b".repeat(64) },
				}),
			).rejects.toThrow("idempotency");
			const path = join(f.root, "composition-productions", "requests.json");
			const saved = JSON.parse(await readFile(path, "utf8"));
			saved.records[0].source.data.currentSceneId = "user-timeline";
			await writeFile(path, JSON.stringify(saved), "utf8");
			const restarted = createCompositionProductionRegistry(f.options);
			await expect(restarted.request(request().idempotencyKey)).rejects.toThrow(
				"source binding",
			);
		}),
);

test("saved Remotion archive transport is not a free sourceDirectory or arbitrary command", () => {
	const parsed = parseCompileInput({
		version: 1,
		engine: "remotion",
		sourceDirectory: "C:/never-read",
		entryFile: "index.tsx",
		files: ["index.tsx"],
		compositionId: "Composition",
		width: 64,
		height: 32,
		frameRate: { numerator: 30, denominator: 1 },
		durationFrames: 30,
		seed: 0,
	});
	expect(parsed.source.build?.engine).toBe("remotion");
	expect(parsed.source.build?.inputs[0].id).toBe("index.tsx");
	expect(parsed.source).not.toHaveProperty("sourceDirectory");
});

test.skipIf(!executable)(
	"fixed archived Remotion delegates only rebuild and preserves exact archive binding",
	async () =>
		fixture(async (f) => {
			const parsed = parseCompileInput({
				version: 1,
				engine: "remotion",
				sourceDirectory: "C:/must-never-read",
				entryFile: "index.tsx",
				files: ["index.tsx"],
				compositionId: "Composition",
				width: 64,
				height: 32,
				frameRate: { numerator: 30, denominator: 1 },
				durationFrames: 30,
				seed: 0,
			});
			const entryBytes = new TextEncoder().encode(
				"retained author source, not executed by this focused fixture",
			);
			const lockBytes = new TextEncoder().encode(
				'{"retained":"toolchain-lock"}',
			);
			const docBytes = new TextEncoder().encode(
				"<!doctype html><html>Retained compiled document</html>",
			);
			const entry = describeResource(
				{
					id: "index.tsx",
					kind: "source",
					mimeType: "application/octet-stream",
				},
				entryBytes.length,
				resourceDigest(entryBytes.buffer),
			);
			const lock = describeResource(
				{
					id: "_rocut/toolchain-lock.json",
					kind: "source",
					mimeType: "application/octet-stream",
				},
				lockBytes.length,
				resourceDigest(lockBytes.buffer),
			);
			const doc = describeResource(
				{ id: "_rocut/compiled.html", kind: "document", mimeType: "text/html" },
				docBytes.length,
				resourceDigest(docBytes.buffer),
			);
			const archived = {
				...parsed.source,
				resources: [doc],
				build: {
					...parsed.source.build!,
					inputs: [entry],
					toolchainLock: lock,
				},
			};
			await f.registry.stage(entry, entryBytes);
			await f.registry.stage(lock, lockBytes);
			await f.registry.stage(doc, docBytes);
			f.attach();
			const input = {
				...request(),
				archive: { source: archived, manifestSha256: "c".repeat(64) },
			};
			const started = await f.registry.start(input);
			await exporting(f, started);
			expect(f.compilerCalls()).toBe(1);
			expect(f.compilerArgs[0].action).toBe("rebuild");
			expect(f.compilerArgs[0].input).toEqual(archived);
			expect(f.compilerArgs[0].input).not.toHaveProperty("sourceDirectory");
			await f.registry.start(input);
			expect(f.compilerCalls()).toBe(1);
			expect(f.frames).toHaveLength(1);
			expect(f.projectWrites()).toBe(0);
		}),
);

test.skipIf(!executable)(
	"durable export intent without native receipt becomes unknown, never redispatched",
	async () =>
		fixture(async (f) => {
			let record = kernel("composition", {
				action: "admit",
				request: request(),
				now: 10,
			}).record;
			for (const event of [
				{ kind: "compileIntent" },
				{ kind: "compiled", source },
				{ kind: "exportIntent" },
			])
				record = kernel("composition", {
					action: "transition",
					record,
					event,
					now: 11,
				}).record;
			await mkdir(join(f.root, "composition-productions"));
			await writeFile(
				join(f.root, "composition-productions", "requests.json"),
				JSON.stringify({ schemaVersion: 1, records: [record] }),
				"utf8",
			);
			f.attach();
			expect((await f.registry.request(request().idempotencyKey))?.phase).toBe(
				"outcome-unknown",
			);
			expect((await f.registry.start(request())).phase).toBe("outcome-unknown");
			expect(f.frames).toHaveLength(0);
			expect(f.compilerCalls()).toBe(0);
		}),
);

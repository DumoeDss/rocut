import { expect, spyOn, test } from "bun:test";
import {
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rename,
	writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { FileProjectStore } from "../file-store";
import {
	restoreBuildSource,
	BuildSourceRestoreIncompleteError,
} from "../programmatic/build-source-restore";
import { buildSourceRestoreIo } from "../programmatic/build-source-restore-files";
import {
	parseCompileInput,
	sourceDescription,
	validateBuildSource,
	LOCK_ID,
	DOCUMENT_ID,
} from "../programmatic/engines/build-source";
import {
	describeResource,
	saveResourceBytes,
} from "../programmatic/resource-bytes";
import { resourceDigest } from "../programmatic/resources";
import { startHost } from "../host";
import { TargetRegistry } from "../target-registry";
import { runCli } from "../main";

async function fixture(
	contextOverride?: { store: FileProjectStore; projectId: string },
	rootOverride?: string,
) {
	const root =
		rootOverride ?? (await mkdtemp("C:/tmps/rocut-build-source-restore-"));
	const context = contextOverride ?? {
		store: new FileProjectStore({
			root: join(root, "project"),
			schemaVersion: 1,
		}),
		projectId: "fixture",
	};
	const author = join(root, "author");
	await mkdir(author);
	const bodies = [
		Buffer.from("<html><body>作者 source</body></html>"),
		Buffer.alloc(0),
		Buffer.from([0, 255, 17]),
	];
	const ids = ["index.html", "empty.txt", "assets/raw.bin"];
	await mkdir(join(author, "assets"));
	const save = async (
		description: Parameters<typeof describeResource>[0],
		bytes: Uint8Array,
	) => {
		const body = Uint8Array.from(bytes).buffer;
		const resource = describeResource(
			description,
			body.byteLength,
			resourceDigest(body),
		);
		await saveResourceBytes(context, { resource, body });
		return resource;
	};
	const { source } = parseCompileInput({
		version: 1,
		engine: "hyperframes",
		sourceDirectory: author,
		entryFile: ids[0],
		files: ids,
		width: 64,
		height: 64,
		frameRate: { numerator: 30, denominator: 1 },
		durationFrames: 60,
		seed: 1,
	});
	const inputs = [];
	for (const [i, id] of ids.entries()) {
		await writeFile(join(author, id), bodies[i]);
		inputs.push(await save(sourceDescription(id), bodies[i]));
	}
	source.build!.inputs = inputs;
	source.build!.toolchainLock = await save(
		sourceDescription(LOCK_ID),
		Buffer.from('{"original":"lock"}'),
	);
	source.resources = [
		await save(
			{ id: DOCUMENT_ID, kind: "document", mimeType: "text/html" },
			Buffer.from("<html><body>compiled</body></html>"),
		),
	];
	validateBuildSource(source);
	await rename(author, join(root, "author-moved"));
	return {
		root,
		context,
		source,
		ids,
		bodies,
		input: { source, outputDirectory: join(root, "restored") },
	};
}

test("restores admitted complete source closure byte-exactly without original folder or project mutation", async () => {
	const f = await fixture();
	const result = await restoreBuildSource({ ...f.context, input: f.input });
	expect(result.status).toBe("complete");
	expect(result.sourceFileCount).toBe(3);
	for (const [i, id] of f.ids.entries())
		expect(await readFile(join(result.sourceDirectory, id))).toEqual(
			f.bodies[i],
		);
	const metadata = JSON.parse(
		await readFile(result.sourceMetadataPath, "utf8"),
	);
	expect(metadata.source).toEqual(f.source);
	expect(metadata.fileMap).toEqual(result.fileMap);
	expect(metadata.automaticallyCompilable).toBe(false);
	expect(metadata.attachmentsImported).toBe(false);
	expect(await readFile(result.toolchainLockPath, "utf8")).toBe(
		'{"original":"lock"}',
	);
	for (const entry of result.fileMap.filter(
		(entry) => entry.role === "resource",
	))
		expect(
			resourceDigest(
				Uint8Array.from(await readFile(join(result.directory, entry.path)))
					.buffer,
			),
		).toBe(entry.resource.sha256);
	expect(JSON.parse(await readFile(result.receiptPath, "utf8")).status).toBe(
		"complete",
	);
	expect(await f.context.store.load({ id: f.context.projectId })).toBeNull();
	await expect(
		restoreBuildSource({ ...f.context, input: f.input }),
	).rejects.toThrow("EEXIST");
});

test("invalid source or missing attachment rejects before output; physical failure retains incomplete owned directory", async () => {
	const f = await fixture();
	for (const input of [
		{ ...f.input, outputDirectory: "relative" },
		{ ...f.input, extra: true },
		{
			...f.input,
			source: {
				...f.source,
				build: { ...f.source.build, entryFile: "missing" },
			},
		},
	])
		await expect(restoreBuildSource({ ...f.context, input })).rejects.toThrow();
	await expect(
		restoreBuildSource({
			...f.context,
			store: new FileProjectStore({
				root: join(f.root, "missing-project"),
				schemaVersion: 1,
			}),
			input: f.input,
		}),
	).rejects.toThrow();
	expect(await readdir(f.root)).not.toContain("restored");
	const original = buildSourceRestoreIo.writeFile;
	let calls = 0;
	const spy = spyOn(buildSourceRestoreIo, "writeFile").mockImplementation(
		async (args) => {
			if (++calls === 2) throw Error("injected IO failure");
			return original(args);
		},
	);
	try {
		await expect(
			restoreBuildSource({ ...f.context, input: f.input }),
		).rejects.toBeInstanceOf(BuildSourceRestoreIncompleteError);
	} finally {
		spy.mockRestore();
	}
	expect(await readdir(f.input.outputDirectory)).toEqual(["source"]);
	await expect(
		readFile(join(f.input.outputDirectory, "metadata/restore-receipt.json")),
	).rejects.toThrow();
});

test("tampered declared attachment rejects before creating any output", async () => {
	const f = await fixture();
	const resource = f.source.resources![0];
	const attachment = await f.context.store.loadAttachment({
		projectId: f.context.projectId,
		key: resource.attachmentKey,
	});
	if (!attachment) throw Error("Missing fixture attachment");
	await f.context.store.saveAttachment({
		projectId: f.context.projectId,
		key: resource.attachmentKey,
		metadata: attachment.metadata,
		body: new Uint8Array(resource.byteLength).buffer,
	});
	await expect(
		restoreBuildSource({ ...f.context, input: f.input }),
	).rejects.toThrow("integrity mismatch");
	expect(await readdir(f.root)).not.toContain("restored");
});

test("authenticated HTTP and CLI source-restore preserve revision and admit no author execution", async () => {
	const root = await mkdtemp("C:/tmps/rocut-build-source-route-");
	const projectRoot = join(root, "project");
	const registryRoot = join(root, "registry");
	const host = await startHost({
		projectRoot,
		registry: new TargetRegistry(registryRoot),
		htmlBrowserExecutable: "",
		htmlFrameConnectionFile: "",
		engineToolchainDirectory: "",
	});
	try {
		const f = await fixture(
			{
				store: new FileProjectStore({ root: projectRoot, schemaVersion: 1 }),
				projectId: host.automation.projectId,
			},
			root,
		);
		const api = (path: string) => new URL(`api/${path}`, host.editorUrl);
		const before = await (await fetch(api("context"))).json();
		const denied = await fetch(
			new URL(
				"/wrong/api/programmatic/resources/restore-build-source",
				host.editorUrl,
			),
			{ method: "POST", body: JSON.stringify(f.input) },
		);
		expect(denied.status).toBe(401);
		await denied.arrayBuffer();
		const response = await fetch(
			api("programmatic/resources/restore-build-source"),
			{ method: "POST", body: JSON.stringify(f.input) },
		);
		const result = await response.json();
		expect(response.status).toBe(200);
		expect(result.compiled).toBe(false);
		const spec = join(root, "restore-spec.json");
		await writeFile(
			spec,
			JSON.stringify({
				...f.input,
				outputDirectory: join(root, "cli-restored"),
			}),
			"utf8",
		);
		let stdout = "";
		const capture = spyOn(process.stdout, "write").mockImplementation(
			(chunk) => {
				stdout += Buffer.from(chunk).toString("utf8");
				return true;
			},
		);
		try {
			await runCli([
				"programmatic",
				"source-restore",
				spec,
				"--project",
				projectRoot,
				"--targets-root",
				registryRoot,
			]);
		} finally {
			capture.mockRestore();
		}
		expect(JSON.parse(stdout).authorCodeExecuted).toBe(false);
		expect(
			await readFile(join(root, "cli-restored/source/index.html")),
		).toEqual(f.bodies[0]);
		expect((await (await fetch(api("context"))).json()).revision).toBe(
			before.revision,
		);
	} finally {
		await host.close();
	}
});

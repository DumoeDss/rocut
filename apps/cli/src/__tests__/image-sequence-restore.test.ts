import { expect, spyOn, test } from "bun:test";
import { constants } from "node:fs";
import { basename, dirname, join } from "node:path";
import {
	mkdir,
	open,
	readFile,
	readdir,
	rename,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { importImageSequence } from "../programmatic/image-sequence-import";
import {
	ImageSequenceRestoreIncompleteError,
	restoreImageSequenceSource,
} from "../programmatic/image-sequence-restore";
import { imageSequenceRestoreIo } from "../programmatic/image-sequence-restore-files";
import {
	imageSequenceFixture,
	ObservedSequenceStore,
} from "./image-sequence-fixture";

async function setup() {
	const fixture = await imageSequenceFixture(1);
	const store = new ObservedSequenceStore(),
		projectId = "source-restore";
	const { resource } = await importImageSequence({
		store,
		projectId,
		input: fixture.input,
	});
	const outputParent = join(fixture.directory, "exports");
	await mkdir(outputParent);
	return { fixture, store, projectId, input: { resource, outputParent } };
}

test("restores exact archived source and original manifest after author removal without frames or overwrites", async () => {
	const context = await setup();
	try {
		const { fixture, input, store } = context;
		await writeFile(join(input.outputParent, "keep.txt"), "untouched");
		await rename(
			fixture.rootDirectory,
			join(fixture.directory, "author-moved"),
		);
		const originalSaves = [...store.saves];
		const result = await restoreImageSequenceSource(context);
		expect(dirname(result.directory)).toBe(input.outputParent);
		expect(result.entryFile).toBe("project.blend");
		expect(result.sourceDirectory).toBe(join(result.directory, "source"));
		expect([
			...(await readFile(join(result.sourceDirectory, result.entryFile))),
		]).toEqual([1, 2, 3, 4, 5]);
		expect([...(await readFile(result.originalManifestPath))]).toEqual([
			...fixture.files.get(fixture.manifest.provenance.originalManifest.id)!,
		]);
		expect(result).toMatchObject({
			sourceFileCount: 1,
			sourceByteLength: 5,
			framesRestored: false,
			incomplete: false,
			engine: "blender",
			parameters: { samples: 16 },
		});
		const receipt = JSON.parse(await readFile(result.receiptPath, "utf8"));
		expect(receipt).toMatchObject({
			resource: input.resource,
			framesRestored: false,
			receiptRole: "provenance-only",
			engineVersion: "4.5.0",
		});
		expect(receipt).not.toHaveProperty("incomplete");
		expect(receipt.sourceFiles).toEqual(
			fixture.manifest.provenance.sourceFiles,
		);
		expect(JSON.stringify(result)).not.toContain('"body"');
		expect(await readdir(result.sourceDirectory)).toEqual(["project.blend"]);
		const again = await restoreImageSequenceSource(context);
		expect(again.directory).not.toBe(result.directory);
		expect(await readFile(join(input.outputParent, "keep.txt"), "utf8")).toBe(
			"untouched",
		);
		expect(store.saves).toEqual(originalSaves);
		expect(store.maxConcurrentLoads).toBe(1);
	} finally {
		await context.fixture.cleanup();
	}
});

test("rejects invalid specs, relative or redirected output roots, cancellation and bad closure before creating output", async () => {
	const context = await setup();
	try {
		const { fixture, input } = context;
		for (const invalid of [
			null,
			{ ...input, extra: true },
			{ ...input, resource: null },
			{ ...input, outputParent: "relative" },
		])
			await expect(
				restoreImageSequenceSource({ ...context, input: invalid }),
			).rejects.toThrow();
		await expect(
			restoreImageSequenceSource({ ...context, signal: AbortSignal.abort() }),
		).rejects.toThrow();
		const linked = join(fixture.directory, "linked-exports");
		await symlink(input.outputParent, linked, "junction");
		await expect(
			restoreImageSequenceSource({
				...context,
				input: { ...input, outputParent: linked },
			}),
		).rejects.toThrow("symlinks or junctions");
		context.store.corruptReadbackKey = fixture.manifest.frames[0].attachmentKey;
		await expect(restoreImageSequenceSource(context)).rejects.toThrow(
			"integrity mismatch",
		);
		expect(await readdir(input.outputParent)).toEqual([]);
	} finally {
		await context.fixture.cleanup();
	}
});

for (const failure of ["cancel", "changed-part"] as const) {
	test(`retains a labelled incomplete directory when ${failure} occurs after full admission`, async () => {
		const context = await setup();
		const controller = new AbortController();
		const nativeLoad = context.store.loadAttachment.bind(context.store);
		const part = context.fixture.manifest.provenance.sourceFiles[0].parts[0];
		const spy = spyOn(context.store, "loadAttachment").mockImplementation(
			async (args) => {
				const loaded = await nativeLoad(args);
				if (
					args.key === part.attachmentKey &&
					(await readdir(context.input.outputParent)).length
				) {
					if (failure === "cancel")
						controller.abort(Error("Cancelled restore fixture"));
					else if (loaded)
						return { ...loaded, body: new Uint8Array([9]).buffer };
				}
				return loaded;
			},
		);
		try {
			const error = await restoreImageSequenceSource({
				...context,
				signal: controller.signal,
			}).then(
				() => undefined,
				(error: unknown) => error,
			);
			expect(error).toBeInstanceOf(ImageSequenceRestoreIncompleteError);
			if (!(error instanceof ImageSequenceRestoreIncompleteError))
				throw Error("Expected incomplete restore");
			expect(error.incomplete).toBe(true);
			expect(dirname(error.directory)).toBe(context.input.outputParent);
			expect(
				JSON.parse(
					await readFile(
						join(error.directory, "metadata", "restore-receipt.json"),
						"utf8",
					),
				).receiptRole,
			).toBe("provenance-only");
			expect(
				(await stat(join(error.directory, "source", "project.blend"))).size,
			).toBe(0);
			expect(await readdir(error.directory)).not.toContain(
				"restore-complete.json",
			);
		} finally {
			spy.mockRestore();
			await context.fixture.cleanup();
		}
	});
}

test("exclusive output open refuses an existing file and preserves its bytes", async () => {
	const context = await setup();
	const nativeOpen = imageSequenceRestoreIo.openFile;
	let existingPath = "";
	const spy = spyOn(imageSequenceRestoreIo, "openFile").mockImplementation(
		async (path) => {
			if (basename(path) === "project.blend") {
				existingPath = path;
				await writeFile(path, "preexisting bytes", { flag: "wx" });
			}
			return nativeOpen(path);
		},
	);
	try {
		await expect(restoreImageSequenceSource(context)).rejects.toThrow("EEXIST");
		expect(await readFile(existingPath, "utf8")).toBe("preexisting bytes");
	} finally {
		spy.mockRestore();
		await context.fixture.cleanup();
	}
});

for (const failure of ["readback-tamper", "late-cancel"] as const) {
	test(`${failure} rejects after writing and never leaves a receipt claiming success`, async () => {
		const context = await setup(),
			controller = new AbortController();
		const nativeOpen = imageSequenceRestoreIo.openFile;
		const restoreSpies: (() => void)[] = [];
		const spy = spyOn(imageSequenceRestoreIo, "openFile").mockImplementation(
			async (path) => {
				const handle = await nativeOpen(path);
				const target =
					failure === "readback-tamper"
						? "project.blend"
						: "original-render-manifest";
				if (basename(path) === target) {
					const nativeSync = handle.sync.bind(handle);
					const syncSpy = spyOn(handle, "sync").mockImplementation(async () => {
						await nativeSync();
						if (failure === "late-cancel")
							controller.abort(Error("Cancel after final payload write"));
						else await handle.write(new Uint8Array([99]), 0, 1, 0);
					});
					restoreSpies.push(() => syncSpy.mockRestore());
				}
				return handle;
			},
		);
		try {
			const error = await restoreImageSequenceSource({
				...context,
				signal: controller.signal,
			}).then(
				() => undefined,
				(error: unknown) => error,
			);
			expect(error).toBeInstanceOf(ImageSequenceRestoreIncompleteError);
			if (!(error instanceof ImageSequenceRestoreIncompleteError))
				throw Error("Expected incomplete restore");
			expect(error.incomplete).toBe(true);
			if (failure === "readback-tamper")
				expect(error.message).toContain("integrity mismatch");
			const receipt = JSON.parse(
				await readFile(
					join(error.directory, "metadata", "restore-receipt.json"),
					"utf8",
				),
			);
			expect(receipt.receiptRole).toBe("provenance-only");
			expect(receipt).not.toHaveProperty("incomplete");
			expect(receipt).not.toHaveProperty("success");
		} finally {
			for (const restore of restoreSpies) restore();
			spy.mockRestore();
			await context.fixture.cleanup();
		}
	});
}

for (const timing of ["before", "after"] as const) {
	test(`parent replacement ${timing} mkdtemp creates no payload and reports incomplete without cleanup`, async () => {
		const context = await setup();
		const nativeTemporary = imageSequenceRestoreIo.createTemporaryDirectory;
		const preserved = join(context.fixture.directory, "preserved-exports");
		const replaceParent = async () => {
			await rename(context.input.outputParent, preserved);
			await mkdir(context.input.outputParent);
		};
		const spy = spyOn(
			imageSequenceRestoreIo,
			"createTemporaryDirectory",
		).mockImplementation(async (prefix) => {
			if (timing === "before") await replaceParent();
			const directory = await nativeTemporary(prefix);
			if (timing === "after") await replaceParent();
			return directory;
		});
		try {
			const error = await restoreImageSequenceSource(context).then(
				() => undefined,
				(error: unknown) => error,
			);
			expect(error).toBeInstanceOf(ImageSequenceRestoreIncompleteError);
			const actualParent =
				timing === "before" ? context.input.outputParent : preserved;
			const entries = await readdir(actualParent);
			expect(entries).toHaveLength(1);
			expect(await readdir(join(actualParent, entries[0]))).toEqual([]);
			expect(
				await readdir(
					timing === "before" ? preserved : context.input.outputParent,
				),
			).toEqual([]);
		} finally {
			spy.mockRestore();
			await context.fixture.cleanup();
		}
	});
}

for (const operation of ["mkdir", "open"] as const) {
	for (const timing of ["before", "after"] as const) {
		test(`ancestor replacement ${timing} ${operation} never writes source payload into either tree`, async () => {
			const context = await setup();
			const nativeDirectory = imageSequenceRestoreIo.createDirectory;
			const nativeOpen = imageSequenceRestoreIo.openFile;
			const preserved = join(context.fixture.directory, "preserved-exports");
			let switched = false,
				restoredName = "";
			const switchTrees = async () => {
				restoredName = (await readdir(context.input.outputParent))[0];
				await rename(context.input.outputParent, preserved);
				await mkdir(join(context.input.outputParent, restoredName), {
					recursive: true,
				});
				if (operation === "open")
					await mkdir(join(context.input.outputParent, restoredName, "source"));
				switched = true;
			};
			const directorySpy = spyOn(
				imageSequenceRestoreIo,
				"createDirectory",
			).mockImplementation(async (path) => {
				const target =
					operation === "mkdir" && basename(path) === "source" && !switched;
				if (target && timing === "before") await switchTrees();
				await nativeDirectory(path);
				if (target && timing === "after") await switchTrees();
			});
			const openSpy = spyOn(
				imageSequenceRestoreIo,
				"openFile",
			).mockImplementation(async (path) => {
				const target =
					operation === "open" &&
					basename(path) === "project.blend" &&
					!switched;
				if (target && timing === "before") await switchTrees();
				const handle = await nativeOpen(path);
				if (target && timing === "after") {
					// Windows prevents moving a tree with this handle open. Move
					// after closing, then return a handle to the SAME retained inode
					// to exercise production's pre-payload identity admission.
					await handle.close();
					await switchTrees();
					return open(
						join(preserved, restoredName, "source", "project.blend"),
						constants.O_RDWR | (constants.O_NOFOLLOW || 0),
					);
				}
				return handle;
			});
			try {
				const error = await restoreImageSequenceSource(context).then(
					() => undefined,
					(error: unknown) => error,
				);
				expect(error).toBeInstanceOf(ImageSequenceRestoreIncompleteError);
				expect(switched).toBe(true);
				for (const parent of [context.input.outputParent, preserved]) {
					const source = join(parent, restoredName, "source");
					const entries = await readdir(source).catch(
						(error: NodeJS.ErrnoException) => {
							if (error.code === "ENOENT") return [];
							throw error;
						},
					);
					for (const entry of entries)
						expect((await stat(join(source, entry))).size).toBe(0);
					expect(await readdir(join(parent, restoredName))).not.toContain(
						"restore-complete.json",
					);
				}
			} finally {
				directorySpy.mockRestore();
				openSpy.mockRestore();
				await context.fixture.cleanup();
			}
		});
	}
}

import { expect, test } from "bun:test";
import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { FileProjectStore } from "../file-store";
import { importProgrammaticResource } from "../programmatic/resource-import";
import { loadProgrammaticResource } from "../programmatic/resources";
import { htmlResourceBootstrap } from "../programmatic/html-resources";
import { isProgrammaticSource } from "../../../../packages/editor-contracts/src/programmatic";

test("model/environment attachments survive reopen and keep Rust MIME/size/integrity policy", async () => {
	const parent = resolve(tmpdir());
	const directory = await mkdtemp(join(parent, "rocut-three-resource-test-"));
	try {
		const options = { root: join(directory, "project"), schemaVersion: 1 };
		const context = {
			store: new FileProjectStore(options),
			projectId: "fixture",
		};
		// The storage layer preserves opaque bytes; format/decode rejection belongs to the runtime loader.
		const bytes = Buffer.from([1, 7, 13, 29, 61, 127]);
		const filePath = join(directory, "owned-resource.bin");
		await writeFile(filePath, bytes);
		for (const [kind, mimeType] of [
			["model", "model/gltf-binary"],
			["environment", "image/vnd.radiance"],
			["environment", "image/x-exr"],
		]) {
			const input = { filePath, id: `${kind}/fixture`, kind, mimeType };
			const resourceOptions = {
				...options,
				root: join(options.root, mimeType.replaceAll("/", "-")),
			};
			const resourceContext = {
				...context,
				store: new FileProjectStore(resourceOptions),
				projectId: `fixture-${mimeType.replaceAll("/", "-")}`,
			};
			const { resource } = await importProgrammaticResource({
				...resourceContext,
				input,
			});
			expect(
				(await importProgrammaticResource({ ...resourceContext, input }))
					.reused,
			).toBe(true);
			const loaded = await loadProgrammaticResource({
				...resourceContext,
				store: new FileProjectStore(resourceOptions),
				resource,
			});
			expect(Buffer.from(loaded.body)).toEqual(bytes);
			expect(
				isProgrammaticSource({
					version: 1,
					runtime: "canvas-worker",
					code: "void 0",
					width: 64,
					height: 64,
					frameRate: { numerator: 30, denominator: 1 },
					durationFrames: 30,
					seed: 1,
					resources: [resource],
				}),
			).toBe(true);
			await expect(
				importProgrammaticResource({
					...resourceContext,
					input: { ...input, mimeType: "model/gltf+json" },
				}),
			).rejects.toThrow();
			const stored = (await resourceContext.store.loadAttachment({
				projectId: resourceContext.projectId,
				key: resource.attachmentKey,
			}))!;
			await resourceContext.store.saveAttachment({
				...stored,
				body: new Uint8Array(bytes.length).buffer,
			});
			await expect(
				loadProgrammaticResource({ ...resourceContext, resource }),
			).rejects.toThrow("integrity mismatch");
		}
		await truncate(filePath, 16 * 1024 * 1024 + 1);
		await expect(
			importProgrammaticResource({
				...context,
				input: {
					filePath,
					id: "oversized.glb",
					kind: "model",
					mimeType: "model/gltf-binary",
				},
			}),
		).rejects.toThrow("16777216");
	} finally {
		if (
			dirname(directory) !== parent ||
			!basename(directory).startsWith("rocut-three-resource-test-")
		)
			throw Error("Unsafe fixture cleanup");
		await rm(directory, { recursive: true, force: true });
	}
});

test("HTML binary bridge exposes copied bytes and frozen descriptors without model URLs or font decoding", async () => {
	const body = new Uint8Array([7, 11, 19, 37]).buffer;
	const resources = ["model", "environment"].map((kind) => ({
		resource: {
			id: `asset/${kind}`,
			kind: kind as "model" | "environment",
			mimeType: kind === "model" ? "model/gltf-binary" : "image/x-exr",
			attachmentKey: "programmatic-sha256-" + "a".repeat(64),
			sha256: "a".repeat(64),
			byteLength: body.byteLength,
		},
		body,
	}));
	const window: {
		rocutResources?: {
			ready: Promise<void>;
			bytes(id: string): ArrayBuffer;
			descriptor(id: string): { kind: string; byteLength: number };
			url(id: string): string;
		};
	} = {};
	runInNewContext(htmlResourceBootstrap(resources), {
		window,
		atob,
		Uint8Array,
		Object,
		Map,
		Promise,
		Error,
	});
	const bridge = window.rocutResources!;
	await bridge.ready;
	for (const kind of ["model", "environment"]) {
		const id = `asset/${kind}`;
		const first = new Uint8Array(bridge.bytes(id));
		expect([...first]).toEqual([7, 11, 19, 37]);
		first[0] = 0;
		expect([...new Uint8Array(bridge.bytes(id))]).toEqual([7, 11, 19, 37]);
		expect(Object.isFrozen(bridge.descriptor(id))).toBe(true);
		expect(bridge.descriptor(id).kind).toBe(kind);
		expect(bridge.descriptor(id).byteLength).toBe(4);
		expect(() => bridge.url(id)).toThrow("Unknown resource");
	}
	for (const method of [bridge.bytes, bridge.descriptor])
		expect(() => method("undeclared")).toThrow("Unknown resource");
	const archive = [
		{
			...resources[0],
			resource: {
				...resources[0]!.resource,
				kind: "source" as const,
				id: "archive.js",
				mimeType: "application/octet-stream",
			},
		},
	];
	expect(htmlResourceBootstrap(archive)).not.toContain("archive.js");
});

test("Three image bytes remain undecoded until the shared loader applies pixel limits", async () => {
	const resources = [
		{
			resource: {
				id: "texture.png",
				kind: "image" as const,
				mimeType: "image/png",
				attachmentKey: "programmatic-sha256-" + "a".repeat(64),
				sha256: "a".repeat(64),
				byteLength: 4,
			},
			body: new Uint8Array([1, 2, 3, 4]).buffer,
		},
	];
	for (const eager of [false, true]) {
		let calls = 0;
		const window: {
			rocutResources?: { ready: Promise<void>; bytes(id: string): ArrayBuffer };
		} = {};
		runInNewContext(htmlResourceBootstrap(resources, eager), {
			window,
			atob,
			Uint8Array,
			Object,
			Map,
			Promise,
			Error,
			Image: class {
				constructor() {
					calls++;
					throw Error("eager image decoder reached");
				}
			},
		});
		if (eager)
			await expect(window.rocutResources!.ready).rejects.toThrow(
				"eager image decoder reached",
			);
		else {
			await window.rocutResources!.ready;
			expect([
				...new Uint8Array(window.rocutResources!.bytes("texture.png")),
			]).toEqual([1, 2, 3, 4]);
		}
		expect(calls).toBe(eager ? 1 : 0);
	}
});

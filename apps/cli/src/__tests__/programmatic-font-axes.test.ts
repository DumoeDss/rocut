import { expect, test } from "bun:test";
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import {
	isProgrammaticResource,
	type ProgrammaticResource,
	type ProgrammaticSource,
} from "@opencut/editor-contracts";
import { startHost } from "../host";
import { TargetRegistry } from "../target-registry";
import { htmlResourceBootstrap } from "../programmatic/html-resources";

test("font axis transport is structured; HTML freezes declarations and escapes CSS tags", async () => {
	const resource: ProgrammaticResource = {
		id: "fixture.ttf",
		kind: "font",
		mimeType: "font/ttf",
		byteLength: 4,
		sha256: "a".repeat(64),
		attachmentKey: `programmatic-sha256-${"a".repeat(64)}`,
		font: {
			family: "Fixture",
			style: "normal",
			weight: 400,
			axes: { 'A"\\Z': -1.25, wdth: 75 },
		},
	};
	expect(isProgrammaticResource(resource)).toBe(true);
	for (const axes of [null, [], "wdth 75", { wdth: "75" }])
		expect(
			isProgrammaticResource({ ...resource, font: { ...resource.font, axes } }),
		).toBe(false);
	// This boundary narrows transport only: semantic tag/finite checks stay in Rust.
	expect(
		isProgrammaticResource({
			...resource,
			font: { ...resource.font, axes: { invalid: 0 } },
		}),
	).toBe(true);
	const faces: { family: string; descriptors: Record<string, string> }[] = [];
	const window: Record<string, any> = {};
	runInNewContext(
		htmlResourceBootstrap([{ resource, body: new ArrayBuffer(4) }]),
		{
			window,
			document: { fonts: { add() {} } },
			FontFace: class {
				constructor(
					family: string,
					_body: unknown,
					public descriptors: Record<string, string>,
				) {
					faces.push({ family, descriptors });
				}
				async load() {
					return this;
				}
			},
		},
	);
	await window.rocutResources.ready;
	expect(faces[0]!.descriptors).toEqual({
		style: "normal",
		weight: "400",
		variationSettings: '"A\\"\\\\Z" -1.25, "wdth" 75',
	});
	const descriptor = window.rocutResources.descriptor(resource.id);
	expect(descriptor).toEqual(resource);
	expect(Object.isFrozen(descriptor.font.axes)).toBe(true);
	expect(Reflect.set(descriptor.font.axes, "wdth", 200)).toBe(false);
	expect(resource.font!.axes!.wdth).toBe(75);
	const old = {
		...resource,
		font: { family: "Static", style: "normal" as const, weight: 500 },
	};
	const oldWindow: Record<string, any> = {};
	runInNewContext(
		htmlResourceBootstrap([{ resource: old, body: new ArrayBuffer(4) }]),
		{
			window: oldWindow,
			document: { fonts: { add() {} } },
			FontFace: class {
				constructor(
					family: string,
					_body: unknown,
					descriptors: Record<string, string>,
				) {
					faces.push({ family, descriptors });
				}
				async load() {
					return this;
				}
			},
		},
	);
	await oldWindow.rocutResources.ready;
	expect(faces[1]!.descriptors).toEqual({ style: "normal", weight: "500" });
});

test("axis declarations survive Agent import, edit, offline reopen and atomic rejection", async () => {
	const parent = resolve(tmpdir()),
		root = await mkdtemp(join(parent, "rocut-font-axes-store-"));
	const filePath = join(root, "fixture.ttf");
	await writeFile(filePath, Buffer.from([0, 1, 0, 0])); // Storage contract, not font decoding.
	const options = {
		projectRoot: join(root, "project"),
		registry: new TargetRegistry(join(root, "registry")),
		htmlBrowserExecutable: "",
		htmlFrameConnectionFile: "",
	};
	let host = await startHost(options);
	const post = (route: string, body: unknown) =>
		fetch(new URL(`api/${route}`, host.editorUrl), {
			method: "POST",
			body: JSON.stringify(body),
		});
	const json = async (route: string, body: unknown) => {
		const response = await post(route, body);
		const value = await response.json();
		if (!response.ok) throw Error(JSON.stringify(value));
		return value;
	};
	const current = async () =>
		(await host.automation.clips())[0]!.editing!.programmatic!;
	const editing = (source: ProgrammaticSource) => ({
		type: "graphic",
		definitionId: "programmatic",
		params: {},
		programmatic: source,
	});
	try {
		const context = await (
			await fetch(new URL("api/context", host.editorUrl))
		).json();
		expect(context.programmaticResources.fontAxes).toBe("static-opentype-v1");
		const catalog = await (
			await fetch(new URL("api/editing/catalog", host.editorUrl))
		).json();
		expect(catalog.programmatic.resources.fontAxes).toBe("static-opentype-v1");
		const input = {
			filePath,
			id: "fixture.ttf",
			kind: "font",
			mimeType: "font/ttf",
			font: {
				family: "AxesFixture",
				style: "normal",
				weight: 400,
				axes: { wdth: 83.125, opsz: 36, GRAD: -25, XTRA: 1.5 },
			},
		};
		const imported = await json("programmatic/resources/import", input);
		expect(imported.resource.font).toEqual(input.font);
		const changed = await json("programmatic/resources/import", {
			...input,
			font: { ...input.font, axes: { XTRA: 9 } },
		});
		expect(changed.reused).toBe(true);
		expect(changed.resource.attachmentKey).toBe(
			imported.resource.attachmentKey,
		);
		expect(changed.resource.font.axes).toEqual({ XTRA: 9 });
		expect(changed.resource).not.toEqual(imported.resource);
		const source: ProgrammaticSource = {
			version: 1,
			runtime: "canvas-worker",
			width: 128,
			height: 64,
			frameRate: { numerator: 30, denominator: 1 },
			durationFrames: 30,
			seed: 1,
			code: "void 0",
			resources: [imported.resource],
		};
		await json("apply", {
			expectedRevision: 0,
			operations: [
				{
					kind: "create-track",
					track: { id: "fonts", name: "Fonts", kind: "graphic", hidden: false },
				},
				{
					kind: "create-clip",
					clip: {
						id: "axes",
						trackId: "fonts",
						startTime: 0,
						duration: 120000,
						trimStart: 0,
						trimEnd: 0,
						editing: editing(source),
					},
				},
			],
		});
		await rename(filePath, join(root, "unavailable-author.ttf"));
		await host.close();
		host = await startHost(options);
		expect(await current()).toEqual(source);
		const loaded = await post("programmatic/resources/load", imported.resource);
		expect(loaded.status).toBe(200);
		expect([...new Uint8Array(await loaded.arrayBuffer())]).toEqual([
			0, 1, 0, 0,
		]);
		const replacement = {
			...source,
			runtime: "html-document" as const,
			resources: [changed.resource],
		};
		await json("apply", {
			expectedRevision: 1,
			operations: [
				{
					kind: "update-clip",
					clipId: "axes",
					patch: { editing: editing(replacement) },
				},
			],
		});
		await host.close();
		host = await startHost(options);
		expect(await current()).toEqual(replacement);
		for (const axes of [{ tooLong: 1 }, { wdth: null }, { wdth: "75" }]) {
			const bad = {
				...replacement,
				resources: [
					{ ...changed.resource, font: { ...changed.resource.font, axes } },
				],
			};
			const rejected = await post("apply", {
				expectedRevision: 2,
				operations: [
					{
						kind: "update-clip",
						clipId: "axes",
						patch: { editing: editing(bad) },
					},
				],
			});
			expect(rejected.status).toBe(409);
			expect(await current()).toEqual(replacement);
		}
		// Explicit removal must not be resurrected by opaque persistence overlays.
		const removed = {
			...replacement,
			resources: [
				{
					...changed.resource,
					font: {
						family: "AxesFixture",
						style: "normal" as const,
						weight: 400,
					},
				},
			],
		};
		await json("apply", {
			expectedRevision: 2,
			operations: [
				{
					kind: "update-clip",
					clipId: "axes",
					patch: { editing: editing(removed) },
				},
			],
		});
		await host.close();
		host = await startHost(options);
		expect(await current()).toEqual(removed);
	} finally {
		await host.close();
		if (
			dirname(root) !== parent ||
			!basename(root).startsWith("rocut-font-axes-store-")
		)
			throw Error("Unsafe font fixture cleanup");
		await rm(root, { recursive: true, force: true });
	}
}, 30000);

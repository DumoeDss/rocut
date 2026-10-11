import { expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { startHost } from "../host";
import { TargetRegistry } from "../target-registry";

// Real installed WASM, catalog, HTTP automation and file store. No GPU claim.
test("Canvas ordered effect source transport survives Host apply/save/reopen", async () => {
	const root = await mkdtemp("C:/tmps/rocut-canvas-host-");
	const options = {
		projectRoot: join(root, "project"),
		registry: new TargetRegistry(join(root, "registry")),
		htmlBrowserExecutable: "",
		htmlFrameConnectionFile: "",
	};
	let host = await startHost(options);
	const request = async (route: string, body?: unknown) => {
		const response = await fetch(new URL(`api/${route}`, host.editorUrl), {
			signal: AbortSignal.timeout(15000),
			...(body === undefined
				? {}
				: {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(body),
					}),
		});
		const value = await response.json();
		expect(response.status).toBe(200);
		return value;
	};
	try {
		const catalog = await request("editing/catalog");
		const fields = catalog.effects.canvas;
		expect(fields).toBeArray();
		expect(
			fields.every((field: { keyframable: boolean }) => !field.keyframable),
		).toBe(true);
		const defaults = Object.fromEntries(
			fields
				.filter((field: { required?: boolean }) => field.required !== false)
				.map((field: { key: string; default: number }) => [
					field.key,
					field.default,
				]),
		);
		const params = {
			...defaults,
			strokeCount: 1,
			stroke0StartTicks: 0,
			stroke0EndTicks: 80000,
			stroke0FromX: 0.12,
			stroke0FromY: 0.25,
			stroke0ToX: 0.88,
			stroke0ToY: 0.75,
			stroke0Radius: 0.13,
			stroke0Bristles: 6,
			stroke0Opacity: 0.85,
			stroke0Wetness: 0.7,
			stroke0Thickness: 0.06,
		};
		const effects = [
			{
				id: "gray-prefix",
				type: "color-adjustment",
				enabled: true,
				params: {
					exposure: 0,
					contrast: 0,
					saturation: -100,
					temperature: 0,
					tint: 0,
				},
			},
			{ id: "paint-first", type: "canvas", enabled: true, params },
			{
				id: "paint-second",
				type: "canvas",
				enabled: true,
				params: { ...params, seed: 19 },
			},
			{ id: "paint-disabled", type: "canvas", enabled: false, params },
		];
		const graphic = Object.fromEntries(
			catalog.graphics.rectangle.map(
				(field: { key: string; default: unknown }) => [
					field.key,
					field.default,
				],
			),
		);
		const editing = {
			type: "graphic",
			name: "Canvas source prefix",
			definitionId: "rectangle",
			params: graphic,
			effects,
		};
		const context = await request("context");
		const applied = await request("apply", {
			expectedRevision: context.revision,
			operations: [
				{
					kind: "create-track",
					track: { id: "paint", kind: "graphic", name: "Paint", hidden: false },
				},
				{
					kind: "create-clip",
					clip: {
						id: "paint-clip",
						trackId: "paint",
						startTime: 0,
						duration: 120000,
						trimStart: 0,
						trimEnd: 0,
						editing,
					},
				},
			],
		});
		expect(applied.accepted).toBe(true);
		const clips = await request("clips");
		expect(
			clips.find((clip: { id: string }) => clip.id === "paint-clip").editing,
		).toEqual(editing);
		const disk = await readFile(join(options.projectRoot, "project.json"));
		await host.close();
		host = await startHost(options);
		expect(await request("clips")).toEqual(clips);
		expect(await readFile(join(options.projectRoot, "project.json"))).toEqual(
			disk,
		);
		expect((await request("context")).revision).toBe(context.revision + 1);
		// Production renderer adapter resolves each occurrence independently and
		// retains the grayscale prefix before both Canvas passes. Source pixels
		// remain the native compositor's ordered-capture responsibility.
		const { registerDefaultEffects } =
			await import("../../../../packages/editor-classic/src/effects");
		const { resolveEffectPassGroups } =
			await import("../../../../packages/editor-classic/src/services/renderer/resolve-visual-state");
		registerDefaultEffects();
		const groups = resolveEffectPassGroups({
			effects,
			localTime: 60000,
			width: 96,
			height: 64,
			frameRate: { numerator: 30, denominator: 1 },
		});
		expect(groups).toHaveLength(3);
		expect(groups.map((group) => group[0].shader)).toEqual([
			"color-adjustment",
			"canvas",
			"canvas",
		]);
		expect(groups[1]).not.toEqual(groups[2]);
		console.log(
			JSON.stringify({
				canvasHostReceipt: root,
				installedWasm: true,
				gpu: false,
			}),
		);
	} finally {
		await host.close();
	}
});

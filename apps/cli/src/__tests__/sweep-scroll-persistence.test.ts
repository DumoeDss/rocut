import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	copyFile,
	mkdir,
	mkdtemp,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type {
	ProgrammaticResource,
	ProgrammaticSource,
} from "@opencut/editor-contracts";
import { startHost } from "../host";
import { TargetRegistry } from "../target-registry";
import {
	scrollScene,
	sweepScene,
	sweepScrollSource,
} from "../../../../script/fixtures/sweep-scroll-fixture";

test("ASCII Sweep and Particle Scroll survive offline Host restart; invalid Agent edits remain atomic", async () => {
	const parent = resolve(
		import.meta.dir,
		"../../../../.artifacts/sweep-scroll-persistence",
	);
	if (process.platform === "win32" && !/^E:/i.test(parent))
		throw Error("Sweep/scroll artifacts must remain on E:");
	await mkdir(parent, { recursive: true });
	const artifacts = await mkdtemp(join(parent, "run-"));
	const root = await mkdtemp(join(artifacts, "working-")),
		author = join(root, "author");
	await mkdir(author);
	const fontPath = join(author, "sweep.ttf"),
		imagePath = join(author, "scroll.png");
	await copyFile(
		resolve(
			import.meta.dir,
			"../../../../apps/web/public/motion-text/fonts/ibm-plex-mono-medium.ttf",
		),
		fontPath,
	);
	await writeFile(
		imagePath,
		Buffer.from(
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM6kAAAAASUVORK5CYII=",
			"base64",
		),
	);
	const originalBytes = [await readFile(fontPath), await readFile(imagePath)];
	const options = {
		projectRoot: join(root, "project"),
		registry: new TargetRegistry(join(root, "registry")),
		htmlBrowserExecutable: "",
		htmlFrameConnectionFile: "",
	};
	let host = await startHost(options);
	const api = (route: string) => new URL(`api/${route}`, host.editorUrl);
	const post = (route: string, body: unknown) =>
		fetch(api(route), { method: "POST", body: JSON.stringify(body) });
	const json = async (route: string, body: unknown) => {
		const response = await post(route, body),
			value = await response.json();
		if (!response.ok) throw Error(JSON.stringify(value));
		return value;
	};
	const revision = async () =>
		(await (await fetch(api("context"))).json()).revision;
	const current = async () =>
		(await host.automation.clips()).map((c) => c.editing!.programmatic!);
	const editing = (programmatic: unknown) => ({
		type: "graphic",
		definitionId: "programmatic",
		params: {},
		programmatic,
	});
	const updates = (sources: unknown[]) =>
		sources.map((source, index) => ({
			kind: "update-clip",
			clipId: `sweep-scroll-${index}`,
			patch: { editing: editing(source) },
		}));
	try {
		const resources: ProgrammaticResource[] = [];
		for (const input of [
			{
				id: "sweep.ttf",
				filePath: fontPath,
				kind: "font",
				mimeType: "font/ttf",
				font: { family: "RocutSweepFixture", weight: 500, style: "normal" },
			},
			{
				id: "scroll.png",
				filePath: imagePath,
				kind: "image",
				mimeType: "image/png",
			},
		])
			resources.push(
				(await json("programmatic/resources/import", input)).resource,
			);
		const a = sweepScene(),
			b = scrollScene(),
			sources = [
				sweepScrollSource(a, resources),
				sweepScrollSource(b, resources),
			];
		await json("apply", {
			expectedRevision: 0,
			operations: [
				{
					kind: "create-track",
					track: {
						id: "sweep-scroll",
						name: "Sweep and scroll",
						kind: "graphic",
						hidden: false,
					},
				},
				...sources.map((source, index) => ({
					kind: "create-clip",
					clip: {
						id: `sweep-scroll-${index}`,
						trackId: "sweep-scroll",
						startTime: index * 120000,
						duration: 120000,
						trimStart: 0,
						trimEnd: 0,
						editing: editing(source),
					},
				})),
			],
		});
		expect(await current()).toEqual(sources);
		await rename(author, join(root, "unavailable-author"));
		await host.close();
		host = await startHost(options);
		expect(await revision()).toBe(1);
		expect(await current()).toEqual(sources);
		for (const [index, resource] of resources.entries()) {
			const response = await post("programmatic/resources/load", resource);
			expect(response.status).toBe(200);
			const bytes = Buffer.from(await response.arrayBuffer());
			expect(bytes).toEqual(originalBytes[index]);
			expect(createHash("sha256").update(bytes).digest("hex")).toBe(
				resource.sha256,
			);
		}
		const modified = [
			sweepScrollSource(
				{
					...a,
					span: { startFrame: 3, durationFrames: 18 },
					settings: {
						...a.settings,
						textB: "UPDATED\nTEXT",
						glyphs: "01XYZ",
						bandWidth: 0.5,
						direction: "rightToLeft",
					},
				},
				resources,
			),
			sweepScrollSource(
				{
					...b,
					settings: {
						...b.settings,
						direction: "bottom-to-top",
						scatter: 0.8,
						spin: -2,
						band: 0.2,
						columns: 8,
						opacity: 0.75,
					},
				},
				resources,
			),
		].map((source) => ({ ...source, seed: 97 }));
		await json("apply", { expectedRevision: 1, operations: updates(modified) });
		await host.close();
		host = await startHost(options);
		expect(await revision()).toBe(2);
		expect(await current()).toEqual(modified);
		const sceneSource = (source: ProgrammaticSource, scene: unknown) => ({
			...source,
			recipe: { ...source.recipe!, nodes: [{ id: "generator", scene }] },
		});
		const expanded = (source: ProgrammaticSource) => ({
			...source,
			recipe: {
				...source.recipe!,
				root: "double",
				nodes: [
					...source.recipe!.nodes,
					{
						id: "double",
						scene: {
							kind: "sequence",
							items: [0, 1].map((i) => ({
								input: "generator",
								span: { startFrame: i * 24, durationFrames: 24 },
								timeMap: [
									{ atFrame: 0, sourceFrame: 0 },
									{ atFrame: 59, sourceFrame: 59 },
								],
							})),
						},
					},
				],
			},
		});
		const fullText = Array(32).fill("A".repeat(128)).join("\n");
		const maximumAscii = {
			...sweepScrollSource(
				{
					...a,
					settings: {
						...a.settings,
						textA: fullText,
						textB: fullText,
						rect: [0, 0, 1, 1],
						fontSize: 4,
					},
				},
				resources,
			),
			width: 384,
			height: 216,
		};
		const maximumScroll = sweepScrollSource(
			{ ...b, settings: { ...b.settings, columns: 63, rows: 64 } },
			resources,
		);
		const invalid = [
			[
				"missing font",
				{
					...sources[0],
					resources: resources.filter((r) => r.kind !== "font"),
				},
			],
			[
				"missing image",
				{
					...sources[1],
					resources: resources.filter((r) => r.kind !== "image"),
				},
			],
			[
				"font bound to image",
				sceneSource(sources[0], {
					...a,
					settings: { ...a.settings, font: "scroll.png" },
				}),
			],
			[
				"image bound to font",
				sceneSource(sources[1], {
					...b,
					settings: { ...b.settings, image: "sweep.ttf" },
				}),
			],
			[
				"unknown ASCII field",
				sceneSource(sources[0], { ...a, settings: { ...a.settings, typo: 1 } }),
			],
			[
				"unknown particle field",
				sceneSource(sources[1], { ...b, settings: { ...b.settings, typo: 1 } }),
			],
			[
				"invalid ASCII direction",
				sceneSource(sources[0], {
					...a,
					settings: { ...a.settings, direction: "diagonal" },
				}),
			],
			[
				"invalid particle direction",
				sceneSource(sources[1], {
					...b,
					settings: { ...b.settings, direction: "diagonal" },
				}),
			],
			[
				"zero ASCII band",
				sceneSource(sources[0], {
					...a,
					settings: { ...a.settings, bandWidth: 0 },
				}),
			],
			[
				"zero particle band",
				sceneSource(sources[1], { ...b, settings: { ...b.settings, band: 0 } }),
			],
			[
				"insufficient text rect",
				sceneSource(sources[0], {
					...a,
					settings: { ...a.settings, rect: [0, 0, 0.01, 0.01] },
				}),
			],
			[
				"too many text columns",
				sceneSource(maximumAscii, {
					...a,
					settings: {
						...a.settings,
						textA: "A".repeat(129),
						rect: [0, 0, 1, 1],
						fontSize: 4,
					},
				}),
			],
			[
				"too many text rows",
				sceneSource(maximumAscii, {
					...a,
					settings: {
						...a.settings,
						textA: Array(33).fill("A").join("\n"),
						rect: [0, 0, 1, 1],
						fontSize: 4,
					},
				}),
			],
			[
				"particle primitive overflow",
				sceneSource(sources[1], {
					...b,
					settings: { ...b.settings, columns: 64, rows: 64 },
				}),
			],
			["expanded ASCII budget", expanded(maximumAscii)],
			["expanded particle budget", expanded(maximumScroll)],
		] as const;
		const rejected: { name: string; status: number }[] = [];
		for (const [name, source] of invalid) {
			const response = await post("apply", {
				expectedRevision: 2,
				operations: updates([sources[0], source]),
			});
			expect(response.status).toBe(409);
			expect(await revision()).toBe(2);
			expect(await current()).toEqual(modified);
			rejected.push({ name, status: response.status });
		}
		await json("apply", {
			expectedRevision: 2,
			operations: updates([maximumAscii, maximumScroll]),
		});
		expect(await current()).toEqual([maximumAscii, maximumScroll]);
		await json("apply", { expectedRevision: 3, operations: updates(sources) });
		await host.close();
		host = await startHost(options);
		expect(await revision()).toBe(4);
		expect(await current()).toEqual(sources);
		const evidence = {
			ok: true,
			resources,
			originalReopenRevision: 1,
			editedReopenRevision: 2,
			restoredReopenRevision: 4,
			invalidAtomicTransactions: rejected,
			maximumPrimitiveCases: { ascii: 4096, particle: 4033 },
			scope:
				"real Host resource import, Agent transactions, offline attachments and reopen persistence; browser rendering is separate",
		};
		await writeFile(
			join(artifacts, "evidence.json"),
			JSON.stringify(evidence, null, 2) + "\n",
			{ encoding: "utf8", flag: "wx" },
		);
		console.log(JSON.stringify({ ...evidence, artifacts }));
	} finally {
		await host.close();
		if (
			dirname(root) !== artifacts ||
			!basename(root).startsWith("working-") ||
			dirname(artifacts) !== parent ||
			!basename(artifacts).startsWith("run-")
		)
			throw Error("Unsafe sweep/scroll fixture cleanup");
		await rm(root, { recursive: true, force: true });
	}
}, 30000);

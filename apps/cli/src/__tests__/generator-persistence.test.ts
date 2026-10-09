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
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type {
	ProgrammaticResource,
	ProgrammaticSource,
} from "@opencut/editor-contracts";
import { startHost } from "../host";
import { TargetRegistry } from "../target-registry";
import {
	generatorSource,
	glyphScene,
	particleScene,
} from "../../../../script/fixtures/generator-fixture";

test("generator Agent edits persist across Host restart without author files; invalid update is atomic", async () => {
	const parent = resolve(tmpdir()),
		root = await mkdtemp(join(parent, "rocut-generator-reopen-"));
	const author = join(root, "author");
	await mkdir(author);
	const fontPath = join(author, "rain.ttf"),
		imagePath = join(author, "logo.png");
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
	const originals = [await readFile(fontPath), await readFile(imagePath)];
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
	const editing = (source: ProgrammaticSource) => ({
		type: "graphic",
		definitionId: "programmatic",
		params: {},
		programmatic: source,
	});
	const update = (sources: ProgrammaticSource[]) =>
		sources.map((source, index) => ({
			kind: "update-clip",
			clipId: `generator-${index}`,
			patch: { editing: editing(source) },
		}));
	try {
		const resources: ProgrammaticResource[] = [];
		for (const input of [
			{
				id: "rain.ttf",
				filePath: fontPath,
				kind: "font",
				mimeType: "font/ttf",
				font: { family: "RocutGeneratorFixture", weight: 500, style: "normal" },
			},
			{
				id: "logo.png",
				filePath: imagePath,
				kind: "image",
				mimeType: "image/png",
			},
		])
			resources.push(
				(await json("programmatic/resources/import", input)).resource,
			);
		expect(await revision()).toBe(0);
		const sources = [
			generatorSource(glyphScene(), resources),
			generatorSource(particleScene(), resources),
		];
		await json("apply", {
			expectedRevision: 0,
			operations: [
				{
					kind: "create-track",
					track: {
						id: "generators",
						name: "Generators",
						kind: "graphic",
						hidden: false,
					},
				},
				...sources.map((source, index) => ({
					kind: "create-clip",
					clip: {
						id: `generator-${index}`,
						trackId: "generators",
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
			expect(bytes).toEqual(originals[index]);
			expect(createHash("sha256").update(bytes).digest("hex")).toBe(
				resource.sha256,
			);
		}
		const rain = glyphScene(),
			particles = particleScene();
		const modified = [
			generatorSource(
				{
					...rain,
					settings: {
						...rain.settings,
						glyphs: "XYZ",
						speed: 9,
						color: [1, 0.2, 0.4, 0.5],
					},
				},
				resources,
			),
			generatorSource(
				{
					...particles,
					settings: {
						...particles.settings,
						direction: "out",
						scatter: 1.5,
						spin: -2,
						columns: 8,
					},
				},
				resources,
			),
		].map((source) => ({ ...source, seed: 37 }));
		await json("apply", { expectedRevision: 1, operations: update(modified) });
		await host.close();
		host = await startHost(options);
		expect(await revision()).toBe(2);
		expect(await current()).toEqual(modified);
		const invalid = generatorSource(
			{ ...particles, settings: { ...particles.settings, columns: 1000000 } },
			resources,
		);
		const rejected = await post("apply", {
			expectedRevision: 2,
			operations: update([sources[0], invalid]),
		});
		expect(rejected.status).toBe(409);
		expect(await revision()).toBe(2);
		expect(await current()).toEqual(modified); // First valid operation must not partially commit.
		await json("apply", { expectedRevision: 2, operations: update(sources) });
		expect(await current()).toEqual(sources);
		const artifactsParent = resolve(
			import.meta.dir,
			"../../../../.artifacts/generator-persistence",
		);
		await mkdir(artifactsParent, { recursive: true });
		const artifacts = await mkdtemp(join(artifactsParent, "run-"));
		const evidence = {
			ok: true,
			resources,
			reopenRevision: 1,
			editedReopenRevision: 2,
			invalidUpdateStatus: rejected.status,
			restoredRevision: await revision(),
			scope:
				"Agent transactions and offline persistence; not attached-editor undo/redo or rendering",
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
			dirname(root) !== parent ||
			!basename(root).startsWith("rocut-generator-reopen-")
		)
			throw Error("Unsafe generator fixture cleanup");
		await rm(root, { recursive: true, force: true });
	}
}, 30000);

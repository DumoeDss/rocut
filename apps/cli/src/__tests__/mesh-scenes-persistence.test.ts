import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { startHost } from "../host";
import { TargetRegistry } from "../target-registry";
import {
	expandedMesh,
	meshHostSources,
	mutateMeshSource,
} from "../../../../script/fixtures/mesh-scenes-host-fixture";

test("mesh recipes preserve resources and edits across offline restart; invalid Agent transactions are atomic", async () => {
	const parent = resolve(
		import.meta.dir,
		"../../../../.artifacts/mesh-scenes-persistence",
	);
	if (process.platform === "win32" && !/^E:/i.test(parent))
		throw Error("Mesh artifacts must remain on E:");
	await mkdir(parent, { recursive: true });
	const artifacts = await mkdtemp(join(parent, "run-")),
		author = join(artifacts, "author");
	await mkdir(author);
	const imagePath = join(author, "mesh.png");
	const original = Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM6kAAAAASUVORK5CYII=",
		"base64",
	);
	await writeFile(imagePath, original, { flag: "wx" });
	const options = {
		projectRoot: join(artifacts, "project"),
		registry: new TargetRegistry(join(artifacts, "registry")),
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
		sources.map((source, i) => ({
			kind: "update-clip",
			clipId: `mesh-${i}`,
			patch: { editing: editing(source) },
		}));
	const reopen = async () => {
		await host.close();
		host = await startHost(options);
	};
	try {
		const resource = (
			await json("programmatic/resources/import", {
				id: "mesh.png",
				filePath: imagePath,
				kind: "image",
				mimeType: "image/png",
			})
		).resource;
		const sources = meshHostSources(resource);
		await json("apply", {
			expectedRevision: 0,
			operations: [
				{
					kind: "create-track",
					track: {
						id: "mesh",
						name: "Mesh scenes",
						kind: "graphic",
						hidden: false,
					},
				},
				...sources.map((source, i) => ({
					kind: "create-clip",
					clip: {
						id: `mesh-${i}`,
						trackId: "mesh",
						startTime: i * 120000,
						duration: 120000,
						trimStart: 0,
						trimEnd: 0,
						editing: editing(source),
					},
				})),
			],
		});
		expect(await current()).toEqual(sources);
		await rename(author, join(artifacts, "unavailable-author"));
		await reopen();
		expect(await revision()).toBe(1);
		expect(await current()).toEqual(sources);
		const response = await post("programmatic/resources/load", resource);
		expect(response.status).toBe(200);
		const bytes = Buffer.from(await response.arrayBuffer());
		expect(bytes).toEqual(original);
		expect(createHash("sha256").update(bytes).digest("hex")).toBe(
			resource.sha256,
		);
		const modified = sources.map((source, index) =>
			mutateMeshSource(source, (v) => {
				v.seed = 97;
				const shot = v.recipe.nodes.at(-1).scene;
				shot.span = { startFrame: 3, durationFrames: 54 };
				shot.easing = "inOutSine";
				if (index === 2)
					Object.assign(shot.style, {
						direction: "down",
						hinge: 0.3,
						perspective: 0.7,
					});
				else
					Object.assign(shot.settings, {
						fit: "cover",
						opacity: 0.6,
						lift: 0.4,
						tilt: index === 0 ? 45 : 0.8,
					});
			}),
		);
		await json("apply", { expectedRevision: 1, operations: updates(modified) });
		await reopen();
		expect(await revision()).toBe(2);
		expect(await current()).toEqual(modified);
		const change = (i: number, mutate: (s: any) => void) =>
			mutateMeshSource(sources[i], (v) => mutate(v.recipe.nodes.at(-1).scene));
		const maxGrid = change(0, (s) =>
			Object.assign(s.settings, { columns: 64, rows: 32 }),
		);
		const maxHex = change(1, (s) => (s.settings.size = 0.0215));
		const invalid: [string, unknown][] = [
			["missing image", { ...sources[0], resources: [] }],
			[
				"undeclared hex image",
				change(1, (s) => (s.settings.image = "missing")),
			],
			["missing grid field", change(0, (s) => delete s.settings.center)],
			["unknown hex field", change(1, (s) => (s.settings.typo = 1))],
			["grid tilt is degrees", change(0, (s) => (s.settings.tilt = 61))],
			["hex tilt is radians", change(1, (s) => (s.settings.tilt = 45))],
			["invalid grid gap", change(0, (s) => (s.settings.gap = 0.7))],
			[
				"invalid hex perspective",
				change(1, (s) => (s.settings.perspective = 0.9)),
			],
			[
				"grid primitive overflow",
				change(0, (s) => Object.assign(s.settings, { columns: 64, rows: 33 })),
			],
			["hex primitive overflow", change(1, (s) => (s.settings.size = 0.0214))],
			["expanded grid budget", expandedMesh(maxGrid)],
			["expanded hex budget", expandedMesh(maxHex)],
			["hex extreme aspect budget", { ...sources[1], width: 4096, height: 1 }],
			["mesh raster budget", { ...sources[0], width: 3072, height: 3072 }],
			["missing bend field", change(2, (s) => delete s.style.hinge)],
			["bend angle is radians", change(2, (s) => (s.style.angle = 180))],
			[
				"bend invalid direction",
				change(2, (s) => (s.style.direction = "diagonal")),
			],
			["bend missing side", change(2, (s) => (s.from = "missing"))],
			["zero span", change(0, (s) => (s.span.durationFrames = 0))],
			["invalid role", change(1, (s) => (s.role = "invalid"))],
		];
		const rejected = [];
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
			operations: updates([maxGrid, maxHex, sources[2]]),
		});
		expect(await current()).toEqual([maxGrid, maxHex, sources[2]]);
		await json("apply", { expectedRevision: 3, operations: updates(sources) });
		await reopen();
		expect(await revision()).toBe(4);
		expect(await current()).toEqual(sources);
		expect(
			await readFile(join(artifacts, "unavailable-author/mesh.png")),
		).toEqual(original);
		const evidence = {
			ok: true,
			resource,
			originalInputUnavailable: true,
			reopenedRevisions: [1, 2, 4],
			invalidAtomicTransactions: rejected,
			maximumPrimitives: { grid: 4096, hexFloat: 4096 },
			scope:
				"real Host import, Agent apply, persistence and offline resource load; browser rendering separately verified",
		};
		await writeFile(
			join(artifacts, "evidence.json"),
			JSON.stringify(evidence, null, 2) + "\n",
			{ flag: "wx" },
		);
		console.log(JSON.stringify({ ...evidence, artifacts }));
	} finally {
		await host.close();
	}
}, 30000);

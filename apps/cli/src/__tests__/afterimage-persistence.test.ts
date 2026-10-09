import { expect, test } from "bun:test";
import { projectId } from "@opencut/editor-contracts";
import { createHash } from "node:crypto";
import {
	mkdir,
	mkdtemp,
	readFile,
	rename,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { ProgrammaticResource } from "@opencut/editor-contracts";
import {
	afterimageScene as scene,
	afterimageSource as source,
	revisedAfterimageScene,
} from "./afterimage-persistence-fixture";
import { imageSequencePng } from "../../../../script/fixtures/image-sequence-png";
import { startHost } from "../host";
import { TargetRegistry } from "../target-registry";

test("afterimage Agent edits and attachment bytes survive offline Host restarts; invalid edits reject atomically", async () => {
	const base = process.env.ROCUT_TEST_ARTIFACT_ROOT ?? tmpdir();
	if (!isAbsolute(base))
		throw Error("Use an absolute private artifact directory");
	const parent = resolve(base);
	const root = await mkdtemp(join(parent, "rocut-afterimage-persistence-"));
	const author = join(root, "author"),
		movedAuthor = join(root, "unavailable-author");
	await mkdir(author);
	const fontBytes = await readFile(
		resolve(
			import.meta.dir,
			"../../../../apps/web/public/motion-text/fonts/ibm-plex-mono-medium.ttf",
		),
	);
	const originals = new Map<string, Uint8Array>([
		["cutout.png", imageSequencePng(17)],
	]);
	for (const id of ["title.ttf", "subtitle.ttf", "credit.ttf"])
		originals.set(id, fontBytes);
	for (const [id, bytes] of originals)
		await writeFile(join(author, id), bytes, { flag: "wx" });
	const options = {
		projectRoot: join(root, "project"),
		registry: new TargetRegistry(join(root, "registry")),
		htmlBrowserExecutable: "",
		htmlFrameConnectionFile: "",
	};
	let host: Awaited<ReturnType<typeof startHost>> | undefined;
	const currentHost = () => {
		if (!host) throw Error("Fixture Host is not running");
		return host;
	};
	const post = (route: string, body: unknown) =>
		fetch(new URL(`api/${route}`, currentHost().editorUrl), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});
	const json = async <T>(route: string, body: unknown): Promise<T> => {
		const response = await post(route, body);
		if (!response.ok)
			throw Error(
				`Afterimage fixture ${route} failed: HTTP ${response.status}: ${(await response.text()).slice(0, 2000)}`,
			);
		return response.json() as Promise<T>;
	};
	const revision = async () =>
		Number(await currentHost().automation.revision());
	const current = async () => {
		const clips = await currentHost().automation.clips();
		expect(clips).toHaveLength(1);
		return clips[0]!.editing!.programmatic!;
	};
	const editing = (programmatic: unknown) => ({
		type: "graphic",
		definitionId: "programmatic",
		params: {},
		programmatic,
	});
	const update = (programmatic: unknown) => ({
		kind: "update-clip",
		clipId: "afterimage-clip",
		patch: { editing: editing(programmatic) },
	});
	const apply = async (
		expectedRevision: number,
		operations: readonly unknown[],
	) => {
		const result = await json<{ accepted: boolean; revision: number }>(
			"apply",
			{ expectedRevision, operations },
		);
		expect(result.accepted).toBe(true);
		expect(Number(result.revision)).toBe(expectedRevision + 1);
		expect(await revision()).toBe(expectedRevision + 1);
	};
	const reopen = async () => {
		await host?.close();
		host = undefined;
		host = await startHost(options);
	};
	try {
		await reopen();
		const resources: ProgrammaticResource[] = [];
		const fonts = [
			{ id: "title.ttf", family: "AfterimageTitleFixture", weight: 900 },
			{ id: "subtitle.ttf", family: "AfterimageSubtitleFixture", weight: 300 },
			{ id: "credit.ttf", family: "AfterimageCreditFixture", weight: 400 },
		];
		for (const input of [
			{
				id: "cutout.png",
				filePath: join(author, "cutout.png"),
				kind: "image",
				mimeType: "image/png",
			},
			...fonts.map(({ id, family, weight }) => ({
				id,
				filePath: join(author, id),
				kind: "font",
				mimeType: "font/ttf",
				font: { family, weight, style: "normal" },
			})),
		])
			resources.push(
				(
					await json<{ resource: ProgrammaticResource }>(
						"programmatic/resources/import",
						input,
					)
				).resource,
			);
		expect(await revision()).toBe(0);
		const initialScene = scene(),
			initial = source(initialScene, resources);
		await apply(0, [
			{
				kind: "update-project",
				projectId: currentHost().automation.projectId,
				patch: { frameRate: { numerator: 30000, denominator: 1001 } },
			},
			{
				kind: "create-track",
				track: {
					id: "afterimage-track",
					name: "Afterimage",
					kind: "graphic",
					hidden: false,
				},
			},
			{
				kind: "create-clip",
				clip: {
					id: "afterimage-clip",
					trackId: "afterimage-track",
					startTime: 0,
					duration: 480480,
					trimStart: 0,
					trimEnd: 0,
					editing: editing(initial),
				},
			},
		]);
		expect(await current()).toEqual(initial);
		expect(dirname(resolve(author))).toBe(root);
		expect(dirname(resolve(movedAuthor))).toBe(root);
		await rename(author, movedAuthor);
		await expect(stat(author)).rejects.toMatchObject({ code: "ENOENT" });
		await reopen();
		expect(await revision()).toBe(1);
		expect(await current()).toEqual(initial);
		for (const resource of resources) {
			const response = await post("programmatic/resources/load", resource);
			expect(response.status).toBe(200);
			const bytes = Buffer.from(await response.arrayBuffer());
			expect(bytes).toEqual(Buffer.from(originals.get(resource.id)!));
			expect(createHash("sha256").update(bytes).digest("hex")).toBe(
				resource.sha256,
			);
		}
		const modifiedScene = revisedAfterimageScene(initialScene);
		const modified = { ...source(modifiedScene, resources), seed: 37 };
		await apply(1, [update(modified)]);
		await reopen();
		expect(await revision()).toBe(2);
		expect(await current()).toEqual(modified);
		const settings = modifiedScene.settings;
		const withScene = (changed: unknown) => ({
			...modified,
			recipe: {
				...modified.recipe!,
				nodes: [{ id: "afterimage", scene: changed }],
			},
		});
		const withSettings = (patch: Record<string, unknown>) =>
			withScene({ ...modifiedScene, settings: { ...settings, ...patch } });
		const invalid: [string, unknown][] = [
			...["cutout.png", "title.ttf", "subtitle.ttf", "credit.ttf"].map(
				(id) =>
					[
						`missing declared ${id}`,
						{
							...modified,
							resources: resources.filter((resource) => resource.id !== id),
						},
					] as [string, unknown],
			),
			[
				"image bound to font",
				withSettings({ cutout: { ...settings.cutout, image: "title.ttf" } }),
			],
			["title font bound to image", withSettings({ titleFont: "cutout.png" })],
			[
				"subtitle font bound to image",
				withSettings({
					subtitle: { ...settings.subtitle, font: "cutout.png" },
				}),
			],
			[
				"credit font bound to image",
				withSettings({ credit: { ...settings.credit, font: "cutout.png" } }),
			],
			[
				"unknown image ID",
				withSettings({ cutout: { ...settings.cutout, image: "missing.png" } }),
			],
			["unknown title font ID", withSettings({ titleFont: "missing.ttf" })],
			["negative grain", withSettings({ grain: -0.01 })],
			["grain above one", withSettings({ grain: 1.01 })],
			["null numeric value", withSettings({ grain: null })],
			["zero time scale", withSettings({ timeScale: 0 })],
			["excessive time scale", withSettings({ timeScale: 4.01 })],
			["negative motion scale", withSettings({ motionScale: -0.01 })],
			["excessive motion scale", withSettings({ motionScale: 4.01 })],
			[
				"zero circle radius",
				withSettings({ circle: { ...settings.circle, radius: 0 } }),
			],
			[
				"zero cutout extent",
				withSettings({ cutout: { ...settings.cutout, rect: [0, 0, 0, 1] } }),
			],
			[
				"out of bounds glyph position",
				withSettings({
					glyphs: [{ ...settings.glyphs[0], center: [3.01, 0.5] }],
				}),
			],
			["invalid color channel", withSettings({ color: [1.01, 0, 0, 1] })],
			[
				"multiple scalars in one glyph",
				withSettings({ glyphs: [{ ...settings.glyphs[0], text: "AB" }] }),
			],
			["no glyphs", withSettings({ glyphs: [] })],
			[
				"text control character",
				withSettings({ credit: { ...settings.credit, text: "invalid\nline" } }),
			],
			["unknown setting", withSettings({ hiddenDefault: true })],
			[
				"fractional span",
				withScene({
					...modifiedScene,
					span: { startFrame: 0.5, durationFrames: 90 },
				}),
			],
			[
				"span past source",
				withScene({
					...modifiedScene,
					span: { startFrame: 100, durationFrames: 30 },
				}),
			],
		];
		const stableProject = await currentHost().automation.project();
		const validPrefix = {
			kind: "update-project" as const,
			projectId: projectId(currentHost().automation.projectId),
			patch: { name: "MUST NOT COMMIT" },
		};
		expect(
			(
				await currentHost().automation.engine.dryRun({
					operations: [validPrefix],
				})
			).accepted,
		).toBe(true);
		for (const [name, value] of invalid) {
			const response = await post("apply", {
				expectedRevision: 2,
				operations: [validPrefix, update(value)],
			});
			expect(response.status, name).toBe(409);
			expect(await response.json(), name).toMatchObject({ accepted: false });
			expect(await revision(), name).toBe(2);
			expect(await current(), name).toEqual(modified);
			expect(await currentHost().automation.project(), name).toEqual(
				stableProject,
			);
		}
		await reopen();
		expect(await revision()).toBe(2);
		expect(await current()).toEqual(modified);
		expect(await currentHost().automation.project()).toEqual(stableProject);
		await apply(2, [update(initial)]);
		await reopen();
		expect(await revision()).toBe(3);
		expect(await current()).toEqual(initial);
		const evidence = {
			passed: true,
			resources,
			rejectedCases: invalid.map(([name]) => name),
			revisions: {
				originalReopen: 1,
				editedReopen: 2,
				rejectedReopen: 2,
				restoredReopen: 3,
			},
			scope:
				"real Host imports, atomic Agent transactions and offline reopen; not browser pixels, export or UI undo/redo",
		};
		await writeFile(
			join(root, "evidence.json"),
			JSON.stringify(evidence, null, 2),
			{ encoding: "utf8", flag: "wx" },
		);
		console.log(
			JSON.stringify({
				afterimagePersistence: true,
				artifacts: root,
				rejected: invalid.length,
			}),
		);
	} finally {
		await host?.close();
		// Keep this private run's source, attachments and evidence for inspection.
	}
}, 30000);

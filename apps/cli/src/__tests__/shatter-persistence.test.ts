import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	mkdir,
	mkdtemp,
	readFile,
	rename,
	stat,
	writeFile,
} from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type {
	MvShatterScene,
	ProgrammaticResource,
	ProgrammaticSource,
	TransactionResult,
} from "@opencut/editor-contracts";
import type {
	DraftCallOutcome,
	DraftRejectionOutcome,
	DraftReviewDocument,
} from "@opencut/editor-contracts/draft";
import { expandedMesh } from "../../../../script/fixtures/mesh-scenes-host-fixture";
import { startHost } from "../host";
import { TargetRegistry } from "../target-registry";

// Opt in with the actual Creator Studio rocut-stylized asset directory.
const templateDirectory = process.env.ROCUT_TEST_CREATOR_TEMPLATES;
interface CreatorTemplates {
	shatterImage(input: { image: ProgrammaticResource }): {
		source: ProgrammaticSource;
		effects: readonly unknown[];
	};
}

function sceneOf(source: ProgrammaticSource): MvShatterScene {
	const scene = source.recipe?.nodes.find((node) => node.id === "shot")?.scene;
	if (scene?.kind !== "shatter")
		throw Error("Creator must emit a shatter scene");
	return scene;
}

function coexist(source: ProgrammaticSource): ProgrammaticSource {
	if (!source.recipe) throw Error("Shatter recipe is required");
	return {
		...source,
		recipe: {
			...source.recipe,
			root: "ab",
			nodes: [
				...source.recipe.nodes,
				{
					id: "solid",
					scene: { kind: "solid", role: "subject", color: [0.2, 0.4, 0.8, 1] },
				},
				{
					id: "ab",
					scene: {
						kind: "transition",
						from: "shot",
						to: "solid",
						span: { startFrame: 3, durationFrames: 54 },
						easing: "inOutSine",
						style: {
							kind: "shatter",
							seed: 71,
							center: [0.3, 0.6],
							columns: 8,
							rows: 6,
						},
					},
				},
			],
		},
	};
}

test.skipIf(!templateDirectory)(
	"Creator shatter survives offline restart, draft preview, edits and atomic validation alongside A/B shatter",
	async () => {
		if (!templateDirectory || !isAbsolute(templateDirectory))
			throw Error("ROCUT_TEST_CREATOR_TEMPLATES must be an absolute directory");
		const templates: CreatorTemplates = await import(
			pathToFileURL(join(templateDirectory, "templates.mjs")).href
		);
		expect(typeof templates.shatterImage).toBe("function");
		const parent = resolve(
			import.meta.dir,
			"../../../../.artifacts/shatter-persistence",
		);
		if (process.platform === "win32" && !/^E:/i.test(parent))
			throw Error("Shatter artifacts must remain on E:");
		await mkdir(parent, { recursive: true });
		const artifacts = await mkdtemp(join(parent, "run-"));
		const author = join(artifacts, "author");
		await mkdir(author);
		const imagePath = join(author, "shatter.png");
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
		const json = async <T>(route: string, body?: unknown): Promise<T> => {
			const response =
				body === undefined ? await fetch(api(route)) : await post(route, body);
			const value: unknown = await response.json();
			if (!response.ok) throw Error(`${route}: ${JSON.stringify(value)}`);
			return value as T;
		};
		const revision = async () =>
			(await json<{ revision: number }>("context")).revision;
		const sourcesOf = (
			clips: Awaited<ReturnType<typeof host.automation.clips>>,
		) =>
			[...clips]
				.sort((a, b) => a.id.localeCompare(b.id))
				.map((clip) => clip.editing?.programmatic);
		const current = async () => sourcesOf(await host.automation.clips());
		const editing = (programmatic: unknown) => ({
			type: "graphic",
			definitionId: "programmatic",
			params: {},
			programmatic,
		});
		const updates = (sources: readonly unknown[]) =>
			sources.map((source, index) => ({
				kind: "update-clip",
				clipId: `shatter-${index}`,
				patch: { editing: editing(source) },
			}));
		const apply = async (
			expectedRevision: number,
			operations: readonly unknown[],
		) => {
			const receipt = await json<TransactionResult & { accepted: boolean }>(
				"apply",
				{
					expectedRevision,
					operations,
				},
			);
			expect(receipt.accepted).toBe(true);
			expect(Number(receipt.revision)).toBe(expectedRevision + 1);
			expect(await revision()).toBe(expectedRevision + 1);
		};
		const reopen = async (
			expectedRevision: number,
			sources: readonly ProgrammaticSource[],
		) => {
			await host.close();
			host = await startHost(options);
			expect(await revision()).toBe(expectedRevision);
			expect(await current()).toEqual([...sources]);
		};
		try {
			const { resource } = await json<{ resource: ProgrammaticResource }>(
				"programmatic/resources/import",
				{
					id: "shatter.png",
					filePath: imagePath,
					kind: "image",
					mimeType: "image/png",
				},
			);
			expect(resource.sha256).toBe(
				createHash("sha256").update(original).digest("hex"),
			);
			const shot = templates.shatterImage({ image: resource });
			expect(shot.effects).toEqual([]);
			expect(shot.source.resources).toEqual([resource]);
			expect(sceneOf(shot.source).settings).toMatchObject({
				fragments: 48,
				image: resource.id,
				spin: 2.4,
			});
			const sources = [shot.source, coexist(shot.source)];
			const operations = [
				{
					kind: "create-track",
					track: {
						id: "shatter",
						name: "Shatter scenes",
						kind: "graphic",
						hidden: false,
					},
				},
				...sources.map((source, index) => ({
					kind: "create-clip",
					clip: {
						id: `shatter-${index}`,
						trackId: "shatter",
						startTime: index * 360000,
						duration: 360000,
						trimStart: 0,
						trimEnd: 0,
						editing: editing(source),
					},
				})),
			];
			// The Host exposes draft staging, not an ignored `dryRun` apply option.
			const draft = await json<{ opened: boolean; draftId: string }>("drafts", {
				approvalMode: "manual",
			});
			expect(draft.opened).toBe(true);
			expect(
				await json<DraftCallOutcome>(`drafts/${draft.draftId}/stage`, {
					operations,
				}),
			).toMatchObject({ accepted: true });
			const preview = await json<DraftReviewDocument>(
				`drafts/${draft.draftId}/review`,
			);
			expect(Number(preview.snapshot.baseRevision)).toBe(0);
			expect(preview.snapshot.acceptedOperationCount).toBe(operations.length);
			expect(sourcesOf(preview.snapshot.working.clips)).toEqual(sources);
			expect(await revision()).toBe(0);
			expect(await current()).toEqual([]);
			expect(
				await json<DraftRejectionOutcome>(
					`drafts/${draft.draftId}/discard`,
					{},
				),
			).toMatchObject({ rejected: true, reason: "discarded" });
			await apply(0, operations);
			expect(await current()).toEqual(sources);
			await rename(author, join(artifacts, "unavailable-author"));
			await expect(stat(imagePath)).rejects.toMatchObject({ code: "ENOENT" });
			await reopen(1, sources);
			const verifyResource = async () => {
				const response = await post("programmatic/resources/load", resource);
				expect(response.status).toBe(200);
				const bytes = Buffer.from(await response.arrayBuffer());
				expect(bytes).toEqual(original);
				expect(createHash("sha256").update(bytes).digest("hex")).toBe(
					resource.sha256,
				);
			};
			await verifyResource();
			const originalScene = sceneOf(shot.source);
			const modifiedScene: MvShatterScene = {
				...originalScene,
				span: { startFrame: 3, durationFrames: 54 },
				easing: "inOutSine",
				settings: {
					...originalScene.settings,
					fragments: 12,
					fit: "cover",
					center: [0.3, 0.6],
					spread: 1.2,
					spin: 3.1,
					gravity: 0.7,
					depth: 0.55,
					perspective: 0.7,
					refraction: 0.04,
					shading: 0.65,
					shadow: 0.5,
					opacity: 0.7,
				},
			};
			const modified = sources.map(
				(source): ProgrammaticSource => ({
					...source,
					seed: 97,
					recipe: {
						...source.recipe!,
						nodes: source.recipe!.nodes.map((node) =>
							node.id === "shot" ? { ...node, scene: modifiedScene } : node,
						),
					},
				}),
			);
			await apply(1, updates(modified));
			await reopen(2, modified);
			const withScene = (scene: unknown) => ({
				...shot.source,
				recipe: { ...shot.source.recipe!, nodes: [{ id: "shot", scene }] },
			});
			const withSettings = (settings: Record<string, unknown>) =>
				withScene({
					...originalScene,
					settings: { ...originalScene.settings, ...settings },
				});
			const maximum: ProgrammaticSource = {
				...shot.source,
				recipe: {
					...shot.source.recipe!,
					nodes: [
						{
							id: "shot",
							scene: {
								...originalScene,
								settings: { ...originalScene.settings, fragments: 512 },
							},
						},
					],
				},
			};
			const { center: omittedCenter, ...missingCenter } =
				originalScene.settings;
			expect(omittedCenter).toEqual([0.5, 0.5]);
			const invalid: readonly (readonly [string, unknown])[] = [
				["missing image resource", { ...shot.source, resources: [] }],
				["undeclared image", withSettings({ image: "missing.png" })],
				[
					"image bound to a video",
					{ ...shot.source, resources: [{ ...resource, kind: "video" }] },
				],
				[
					"missing required center",
					withScene({ ...originalScene, settings: missingCenter }),
				],
				["unknown settings field", withSettings({ typo: 1 })],
				[
					"legacy transition fields on scene",
					withSettings({ columns: 8, rows: 6 }),
				],
				["refraction overflow", withSettings({ refraction: 0.081 })],
				["perspective overflow", withSettings({ perspective: 0.81 })],
				["spin is radians", withSettings({ spin: 180 })],
				["too few fragments", withSettings({ fragments: 3 })],
				["noninteger fragments", withSettings({ fragments: 4.5 })],
				["fragment primitive overflow", withSettings({ fragments: 513 })],
				["expanded primitive budget", expandedMesh(maximum)],
				["mesh raster budget", { ...shot.source, width: 3072, height: 3072 }],
				["out of range center", withSettings({ center: [-0.01, 0.5] })],
				["invalid fit", withSettings({ fit: "tile" })],
				[
					"zero span",
					withScene({
						...originalScene,
						span: { startFrame: 0, durationFrames: 0 },
					}),
				],
				["invalid role", withScene({ ...originalScene, role: "invalid" })],
			];
			const rejected: { name: string; status: number; result: unknown }[] = [];
			for (const [name, source] of invalid) {
				// The first update is valid AND changes current state: partial commits must fail this test.
				const response = await post("apply", {
					expectedRevision: 2,
					operations: updates([sources[0], source]),
				});
				const result: unknown = await response.json();
				expect(response.status, name).toBe(409);
				expect(result, name).toMatchObject({ accepted: false });
				expect(await revision(), name).toBe(2);
				expect(await current(), name).toEqual(modified);
				rejected.push({ name, status: response.status, result });
			}
			await apply(2, updates([maximum, sources[1]]));
			expect(await current()).toEqual([maximum, sources[1]]);
			await apply(3, updates(sources));
			await reopen(4, sources);
			await apply(4, updates(modified));
			await reopen(5, modified);
			await verifyResource();
			expect(
				await readFile(join(artifacts, "unavailable-author", "shatter.png")),
			).toEqual(original);
			const evidence = {
				ok: true,
				template: "shatterImage",
				resource,
				originalInputUnavailable: true,
				dryRun: {
					mechanism: "manual draft stage/review/discard",
					committedRevision: 0,
					operationCount: operations.length,
				},
				reopenedRevisions: [1, 2, 4, 5],
				invalidAtomicTransactions: rejected,
				maximumFragments: 512,
				maximumChargedPrimitives: 4096,
				coexistence: ["scene.kind:shatter", "transition.style.kind:shatter"],
				originalSources: sources,
				reappliedSources: modified,
				scope:
					"real Creator helper and Host resource import, draft preview, apply, offline restart, restore and reapply; rendering verified separately",
			};
			await writeFile(
				join(artifacts, "evidence.json"),
				JSON.stringify(evidence, null, 2) + "\n",
				{ encoding: "utf8", flag: "wx" },
			);
			console.log(
				JSON.stringify({
					ok: true,
					artifacts,
					reopenedRevisions: evidence.reopenedRevisions,
					invalidCases: rejected.length,
				}),
			);
		} finally {
			await host.close();
		}
	},
	30000,
);

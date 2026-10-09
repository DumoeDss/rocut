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
	MvCloth,
	MvClothEvent,
	MvClothScene,
	MvRole,
	ProgrammaticResource,
	ProgrammaticSource,
	TransactionResult,
} from "@opencut/editor-contracts";
import type {
	DraftCallOutcome,
	DraftRejectionOutcome,
	DraftReviewDocument,
} from "@opencut/editor-contracts/draft";
import { startHost } from "../host";
import { TargetRegistry } from "../target-registry";

const templateDirectory = process.env.ROCUT_TEST_CREATOR_TEMPLATES;
interface CreatorTemplates {
	clothImage(input: {
		image: ProgrammaticResource;
		settings?: Partial<
			Pick<
				ProgrammaticSource,
				"width" | "height" | "durationFrames" | "frameRate" | "seed"
			>
		>;
		cloth?: Partial<MvCloth>;
		role?: MvRole;
		span?: MvClothScene["span"];
	}): { source: ProgrammaticSource; effects: readonly unknown[] };
}

function sceneOf(source: ProgrammaticSource): MvClothScene {
	const scene = source.recipe?.nodes.find((node) => node.id === "shot")?.scene;
	if (scene?.kind !== "cloth") throw Error("Creator must emit a cloth scene");
	return scene;
}

function replaceScene(
	source: ProgrammaticSource,
	scene: MvClothScene,
): ProgrammaticSource {
	if (!source.recipe) throw Error("Cloth recipe is required");
	return {
		...source,
		recipe: { ...source.recipe, nodes: [{ id: "shot", scene }] },
	};
}

function expandedSimulation(source: ProgrammaticSource): ProgrammaticSource {
	if (!source.recipe) throw Error("Cloth recipe is required");
	const nodes = [...source.recipe.nodes];
	let input = "shot";
	for (let depth = 0; depth < 5; depth += 1) {
		const id = `double-${depth}`;
		nodes.push({
			id,
			scene: {
				kind: "transition",
				from: input,
				to: input,
				span: sceneOf(source).span,
				easing: "linear",
				style: { kind: "xfade" },
			},
		});
		input = id;
	}
	// 32 four-by-four Cloth occurrences cost 2,048 primitives, below that cap.
	return { ...source, recipe: { ...source.recipe, root: input, nodes } };
}

test.skipIf(!templateDirectory)(
	"Creator Cloth preserves attachments, full authoring state and unrelated clips across preview, offline restart and atomic validation",
	async () => {
		if (!templateDirectory || !isAbsolute(templateDirectory))
			throw Error("ROCUT_TEST_CREATOR_TEMPLATES must be an absolute directory");
		const templates: CreatorTemplates = await import(
			pathToFileURL(join(templateDirectory, "templates.mjs")).href
		);
		expect(typeof templates.clothImage).toBe("function");
		const parent = resolve(
			import.meta.dir,
			"../../../../.artifacts/cloth-persistence",
		);
		if (process.platform === "win32" && !/^E:/i.test(parent))
			throw Error("Cloth artifacts must remain on E:");
		await mkdir(parent, { recursive: true });
		const artifacts = await mkdtemp(join(parent, "run-"));
		const author = join(artifacts, "author");
		await mkdir(author);
		const imagePath = join(author, "cloth.png");
		const originalBytes = Buffer.from(
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM6kAAAAASUVORK5CYII=",
			"base64",
		);
		await writeFile(imagePath, originalBytes, { flag: "wx" });
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
		const clips = async () =>
			[...(await host.automation.clips())].sort((a, b) =>
				a.id.localeCompare(b.id),
			);
		const tracks = async () =>
			[...(await host.automation.tracks())].sort((a, b) =>
				a.id.localeCompare(b.id),
			);
		const editing = (name: string, programmatic: unknown) => ({
			type: "graphic",
			name,
			definitionId: "programmatic",
			params: {},
			programmatic,
		});
		const update = (clipId: string, source: unknown) => ({
			kind: "update-clip",
			clipId,
			patch: { editing: editing(clipId, source) },
		});
		const apply = async (
			expectedRevision: number,
			operations: readonly unknown[],
		) => {
			const receipt = await json<TransactionResult & { accepted: boolean }>(
				"apply",
				{ expectedRevision, operations },
			);
			expect(receipt.accepted).toBe(true);
			expect(Number(receipt.revision)).toBe(expectedRevision + 1);
			expect(await revision()).toBe(expectedRevision + 1);
		};
		const reopenedRevisions: number[] = [];
		try {
			const { resource } = await json<{ resource: ProgrammaticResource }>(
				"programmatic/resources/import",
				{
					id: "cloth.png",
					filePath: imagePath,
					kind: "image",
					mimeType: "image/png",
				},
			);
			expect(resource.sha256).toBe(
				createHash("sha256").update(originalBytes).digest("hex"),
			);
			const impulse: MvClothEvent = {
				atTicks: 120000,
				center: [0.3, 0.7],
				radius: 0.4,
				velocity: [-0.2, 0.1, 1.2],
			};
			const shot = templates.clothImage({
				image: resource,
				span: { startFrame: 4, durationFrames: 60 },
				cloth: { events: [{ ...impulse, atTicks: 0 }, impulse] },
			});
			expect(shot.effects).toEqual([]);
			expect(shot.source.resources).toEqual([resource]);
			expect(Object.hasOwn(sceneOf(shot.source), "easing")).toBe(false);
			const original = shot.source;
			const base = sceneOf(original);
			const sentinel: ProgrammaticSource = {
				...original,
				resources: [],
				recipe: {
					version: 1,
					root: "solid",
					songStartSeconds: 0,
					outputRoles: ["background"],
					nodes: [
						{
							id: "solid",
							scene: {
								kind: "solid",
								role: "background",
								color: [0.1, 0.2, 0.3, 1],
							},
						},
					],
				},
			};
			const sourceList = [original, sentinel];
			const ids = ["cloth-primary", "cloth-sentinel"];
			const operations = [
				{
					kind: "create-track",
					track: {
						id: "cloth",
						name: "Cloth persistence",
						kind: "graphic",
						hidden: false,
					},
				},
				...sourceList.map((source, index) => ({
					kind: "create-clip",
					clip: {
						id: ids[index],
						trackId: "cloth",
						startTime: index * 360000,
						duration: 360000,
						trimStart: 0,
						trimEnd: 0,
						editing: editing(ids[index]!, source),
					},
				})),
			];
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
			expect(preview.snapshot.acceptedOperationCount).toBe(3);
			for (const [index, id] of ids.entries())
				expect(
					preview.snapshot.working.clips.find((clip) => clip.id === id)?.editing
						?.programmatic,
				).toEqual(sourceList[index]);
			expect(await revision()).toBe(0);
			expect(await clips()).toEqual([]);
			expect(
				await json<DraftRejectionOutcome>(
					`drafts/${draft.draftId}/discard`,
					{},
				),
			).toMatchObject({ rejected: true, reason: "discarded" });
			await apply(0, operations);
			const sentinelClip = (await clips()).find(
				(clip) => clip.id === "cloth-sentinel",
			);
			expect(sentinelClip).toBeDefined();
			const baselineTracks = await tracks();
			const baselineProject = await host.automation.project();
			const assertState = async (source: ProgrammaticSource) => {
				const current = await clips();
				expect(current).toHaveLength(2);
				expect(
					current.find((clip) => clip.id === "cloth-primary")?.editing
						?.programmatic,
				).toEqual(source);
				expect(current.find((clip) => clip.id === "cloth-sentinel")).toEqual(
					sentinelClip,
				);
				expect(await tracks()).toEqual(baselineTracks);
				expect(await host.automation.project()).toEqual(baselineProject);
			};
			const reopen = async (
				expectedRevision: number,
				source: ProgrammaticSource,
			) => {
				await assertState(source);
				const before = await clips();
				await host.close();
				host = await startHost(options);
				expect(await revision()).toBe(expectedRevision);
				expect(await clips()).toEqual(before);
				await assertState(source);
				reopenedRevisions.push(expectedRevision);
			};
			await rename(author, join(artifacts, "unavailable-author"));
			await expect(stat(imagePath)).rejects.toMatchObject({ code: "ENOENT" });
			await reopen(1, original);
			const verifyAttachment = async () => {
				const response = await post("programmatic/resources/load", resource);
				expect(response.status).toBe(200);
				const bytes = Buffer.from(await response.arrayBuffer());
				expect(bytes).toEqual(originalBytes);
				expect(createHash("sha256").update(bytes).digest("hex")).toBe(
					resource.sha256,
				);
			};
			await verifyAttachment();
			const modified = {
				...replaceScene(original, {
					kind: "cloth",
					role: "foreground",
					span: { startFrame: 7, durationFrames: 48 },
					settings: {
						image: resource.id,
						rect: [0.1, 0.2, 0.7, 0.6],
						fit: "cover",
						columns: 8,
						rows: 6,
						pins: "leftEdge",
						gravity: 0.7,
						wind: [-0.4, 0.2, 1.1],
						gust: 0.7,
						gustFrequency: 1.2,
						damping: 3.1,
						stretchCompliance: 0.00001,
						bendCompliance: 0.003,
						solverIterations: 8,
						perspective: 0.4,
						shading: 0.65,
						opacity: 0.7,
						events: [
							{
								atTicks: 1001,
								center: [0.6, 0.4],
								radius: 0.3,
								velocity: [0.4, -0.2, -0.6],
							},
							{
								atTicks: 80000,
								center: [0.2, 0.8],
								radius: 0.8,
								velocity: [-0.3, 0.1, 0.9],
							},
						],
					},
				}),
				seed: 97,
			};
			await apply(1, [update("cloth-primary", modified)]);
			await reopen(2, modified);
			const invalidScene = (scene: unknown) => ({
				...original,
				recipe: {
					...original.recipe!,
					nodes: [{ id: "shot", scene }],
				},
			});
			const invalidSettings = (settings: Record<string, unknown>) =>
				invalidScene({ ...base, settings: { ...base.settings, ...settings } });
			const fullDuration = {
				...replaceScene(original, {
					...base,
					span: { startFrame: 0, durationFrames: 900 },
					settings: {
						...base.settings,
						columns: 4,
						rows: 4,
						solverIterations: 12,
						events: [],
					},
				}),
				width: 320,
				height: 180,
				durationFrames: 901,
			};
			const invalid: [string, unknown][] = [
				[
					"missing image attachment declaration",
					{ ...original, resources: [] },
				],
				["undeclared image", invalidSettings({ image: "missing.png" })],
				[
					"wrong resource kind",
					{ ...original, resources: [{ ...resource, kind: "video" }] },
				],
				["missing compliance", invalidSettings({ bendCompliance: undefined })],
				[
					"unknown easing on physical scene",
					invalidScene({ ...base, easing: "linear" }),
				],
				["unknown settings field", invalidSettings({ easing: "linear" })],
				["invalid role", invalidScene({ ...base, role: "invalid" })],
				[
					"zero span",
					invalidScene({ ...base, span: { startFrame: 4, durationFrames: 0 } }),
				],
				["columns lower bound", invalidSettings({ columns: 1 })],
				["columns upper bound", invalidSettings({ columns: 25 })],
				["columns integer", invalidSettings({ columns: 2.5 })],
				["rows upper bound", invalidSettings({ rows: 25 })],
				["unknown pins", invalidSettings({ pins: "bottomEdge" })],
				["gravity upper bound", invalidSettings({ gravity: 4.01 })],
				["wind shape", invalidSettings({ wind: [0, 1] })],
				["wind bounds", invalidSettings({ wind: [0, -4.01, 0] })],
				[
					"negative stretch compliance",
					invalidSettings({ stretchCompliance: -0.001 }),
				],
				[
					"stretch compliance upper bound",
					invalidSettings({ stretchCompliance: 0.00101 }),
				],
				["negative bend compliance", invalidSettings({ bendCompliance: -0.1 })],
				[
					"bend compliance upper bound",
					invalidSettings({ bendCompliance: 0.101 }),
				],
				["solver iteration bounds", invalidSettings({ solverIterations: 13 })],
				[
					"too many events",
					invalidSettings({ events: Array(17).fill(impulse) }),
				],
				[
					"unsorted events",
					invalidSettings({ events: [impulse, { ...impulse, atTicks: 1 }] }),
				],
				["mesh raster budget", { ...original, width: 3072, height: 3072 }],
				[
					"source span exceeds 30 seconds",
					{
						...replaceScene(fullDuration, {
							...sceneOf(fullDuration),
							span: { startFrame: 0, durationFrames: 901 },
						}),
						durationFrames: 902,
					},
				],
				["expanded simulation work", expandedSimulation(fullDuration)],
			];
			for (const [name, patch] of [
				["negative ticks", { atTicks: -1 }],
				["fractional ticks", { atTicks: 0.5 }],
				["unsafe ticks", { atTicks: Number.MAX_SAFE_INTEGER + 1 }],
				["ticks upper bound", { atTicks: 3600001 }],
				["event at span end", { atTicks: 240000 }],
				["event after span end", { atTicks: 240001 }],
				["center bounds", { center: [-0.1, 0.5] }],
				["radius lower bound", { radius: 0.009 }],
				["radius upper bound", { radius: 2.001 }],
				["velocity bound", { velocity: [0, 0, 3.01] }],
				["missing velocity", { velocity: undefined }],
				["unknown event field", { typo: 1 }],
			] as const)
				invalid.push([
					name,
					invalidSettings({ events: [{ ...impulse, ...patch }] }),
				]);
			const beforeInvalid = await clips();
			const rejected: { name: string; status: number; result: unknown }[] = [];
			for (const [name, source] of invalid) {
				// A valid unrelated-clip edit precedes the invalid Cloth edit; both must roll back.
				const response = await post("apply", {
					expectedRevision: 2,
					operations: [
						update("cloth-sentinel", { ...sentinel, seed: 123 }),
						update("cloth-primary", source),
					],
				});
				const result: unknown = await response.json();
				expect(response.status, name).toBe(409);
				expect(result, name).toMatchObject({ accepted: false });
				expect(await revision(), name).toBe(2);
				expect(await clips(), name).toEqual(beforeInvalid);
				rejected.push({ name, status: response.status, result });
			}
			const boundaries = replaceScene(original, {
				...base,
				settings: {
					...base.settings,
					columns: 24,
					rows: 24,
					pins: "topCorners",
					solverIterations: 12,
					stretchCompliance: 0.001,
					bendCompliance: 0.1,
					events: Array.from({ length: 16 }, (_, index) => ({
						...impulse,
						atTicks: index === 0 ? 0 : 239999,
					})),
				},
			});
			await apply(2, [update("cloth-primary", boundaries)]);
			await reopen(3, boundaries);
			await apply(3, [update("cloth-primary", fullDuration)]);
			await reopen(4, fullDuration);
			await apply(4, [update("cloth-primary", original)]);
			await reopen(5, original);
			await apply(5, [update("cloth-primary", modified)]);
			await reopen(6, modified);
			await verifyAttachment();
			expect(
				await readFile(join(artifacts, "unavailable-author", "cloth.png")),
			).toEqual(originalBytes);
			const evidence = {
				ok: true,
				template: "clothImage",
				resource,
				preview: "manual draft stage/review/discard with committed revision 0",
				originalInputUnavailable: true,
				reopenedRevisions,
				invalidAtomicTransactions: rejected,
				acceptedBoundaries: {
					columns: 24,
					rows: 24,
					events: 16,
					lastEventTicks: 239999,
					spanEndTicks: 240000,
					durationSeconds: 30,
				},
				originalSource: original,
				reappliedSource: modified,
				unrelatedClip: sentinelClip,
				scope:
					"real Creator helper, Host transactions and offline attachment persistence; physical simulation and raster output are tested separately",
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
					reopenedRevisions,
					invalidCases: rejected.length,
				}),
			);
		} finally {
			await host.close();
		}
	},
	30000,
);

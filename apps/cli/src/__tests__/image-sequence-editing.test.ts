import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFile, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import type {
	ImageSequenceManifest,
	ProgrammaticResource,
	ProgrammaticSource,
	TransactionResult,
} from "@opencut/editor-contracts";
import type {
	DraftCallOutcome,
	DraftRejectionOutcome,
	DraftReviewDocument,
} from "@opencut/editor-contracts/draft";
import { CURRENT_PROJECT_VERSION } from "@opencut/editor-classic/transactions";
import { resolveProgrammaticFrame } from "../../../../packages/editor-classic/src/services/renderer/programmatic/frame";
import { resolveMvResourceFrame } from "../../../../packages/editor-classic/src/services/renderer/programmatic/mv-resource-frame";
import { FileProjectStore } from "../file-store";
import { startHost } from "../host";
import { TargetRegistry } from "../target-registry";
import { loadImageSequenceClosure } from "../programmatic/image-sequence-closure";
import { imageSequenceFixture } from "./image-sequence-fixture";

function sequenceSource({
	resource,
	sequence = resource.id,
	originSourceTicks = 0,
	speed = 1,
}: {
	resource: ProgrammaticResource;
	sequence?: string;
	originSourceTicks?: number;
	speed?: number;
}): ProgrammaticSource {
	return {
		version: 1,
		runtime: "canvas-worker",
		code: "",
		width: 2,
		height: 1,
		frameRate: { numerator: 30000, denominator: 1001 },
		durationFrames: 60,
		seed: 29,
		resources: [resource],
		recipe: {
			version: 1,
			root: "sequence",
			songStartSeconds: 50,
			outputRoles: ["background"],
			nodes: [
				{
					id: "sequence",
					scene: {
						kind: "imageSequence",
						sequence,
						originSourceTicks,
						rate: { numerator: speed, denominator: speed === 3 ? 2 : 1 },
						role: "background",
						view: { x: 0, y: 0, zoom: 1 },
					},
				},
			],
		},
	};
}

test("image sequence survives real draft/apply transactions, rational trim edits and offline Host restart", async () => {
	const fixture = await imageSequenceFixture(12);
	const options = {
		projectRoot: join(fixture.directory, "editing-project"),
		registry: new TargetRegistry(join(fixture.directory, "registry")),
		htmlBrowserExecutable: "",
		htmlFrameConnectionFile: "",
		engineToolchainDirectory: "",
	};
	let host: Awaited<ReturnType<typeof startHost>> | undefined;
	const api = (route: string) => new URL(`api/${route}`, host!.editorUrl);
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
	const persisted = () =>
		readFile(join(options.projectRoot, "project.json"), "utf8");
	const current = async () => {
		const clips = await host!.automation.clips();
		expect(clips).toHaveLength(1);
		const clip = clips[0];
		if (!clip.editing?.programmatic)
			throw Error("Saved sequence clip lost its programmatic source");
		return { clip, source: clip.editing.programmatic };
	};
	const editing = (programmatic: ProgrammaticSource) => ({
		type: "graphic",
		definitionId: "programmatic",
		params: {},
		programmatic,
	});
	const apply = async (
		expectedRevision: number,
		operations: readonly unknown[],
	) => {
		const result = await json<TransactionResult & { accepted: boolean }>(
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
		host = await startHost(options);
		const beforeImport = await persisted();
		const imported = await json<{
			resource: ProgrammaticResource;
			manifest: ImageSequenceManifest;
		}>("programmatic/resources/import-image-sequence", fixture.input);
		expect(imported.manifest).toEqual(fixture.manifest);
		expect(imported.manifest.firstFileFrame).toBe(1001);
		expect(await revision()).toBe(0);
		expect(await persisted()).toBe(beforeImport);
		const source = sequenceSource({ resource: imported.resource });
		const tick = 4004,
			startTime = 3 * tick,
			duration = 8 * tick,
			trimStart = 2 * tick,
			trimEnd = 50 * tick;
		const operations = [
			{
				kind: "update-project",
				projectId: host.automation.projectId,
				patch: { frameRate: source.frameRate },
			},
			{
				kind: "create-track",
				track: {
					id: "sequences",
					name: "Image sequences",
					kind: "graphic",
					hidden: false,
				},
			},
			{
				kind: "create-clip",
				clip: {
					id: "sequence-clip",
					trackId: "sequences",
					startTime,
					duration,
					trimStart,
					trimEnd,
					editing: editing(source),
				},
			},
		];
		// Draft staging is the actual Host dry-run API; apply has no dryRun flag.
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
		expect(preview.snapshot.working.clips[0].editing?.programmatic).toEqual(
			source,
		);
		expect(preview.snapshot.working.clips[0]).toMatchObject({
			startTime,
			duration,
			trimStart,
			trimEnd,
		});
		expect(await host.automation.clips()).toEqual([]);
		expect(await revision()).toBe(0);
		expect(await persisted()).toBe(beforeImport);
		expect(
			await json<DraftRejectionOutcome>(`drafts/${draft.draftId}/discard`, {}),
		).toMatchObject({ rejected: true, reason: "discarded" });
		await apply(0, operations);
		expect((await current()).source).toEqual(source);
		await rename(
			fixture.rootDirectory,
			join(fixture.directory, "author-moved"),
		);
		await expect(stat(fixture.manifestPath)).rejects.toMatchObject({
			code: "ENOENT",
		});
		await reopen();
		expect(await revision()).toBe(1);
		expect((await host.automation.project())?.frameRate).toEqual(
			source.frameRate,
		);
		expect((await current()).source).toEqual(source);
		expect((await current()).clip).toMatchObject({
			startTime,
			duration,
			trimStart,
			trimEnd,
		});
		const store = new FileProjectStore({
			root: options.projectRoot,
			schemaVersion: CURRENT_PROJECT_VERSION,
		});
		expect(
			(
				await loadImageSequenceClosure({
					store,
					projectId: host.automation.projectId,
					resource: imported.resource,
				})
			).manifest,
		).toEqual(fixture.manifest);
		const load = async (resource: ProgrammaticResource) => {
			const response = await post("programmatic/resources/load", resource);
			expect(response.status).toBe(200);
			const body = await response.arrayBuffer();
			expect(body.byteLength).toBe(resource.byteLength);
			expect(
				createHash("sha256").update(new Uint8Array(body)).digest("hex"),
			).toBe(resource.sha256);
			return { resource, body };
		};
		const resolveOrdinal = async (offset: number, expected: number) => {
			const { clip, source: saved } = await current();
			const declared = saved.resources?.[0];
			if (!declared) throw Error("Saved sequence resource is missing");
			expect(declared).toEqual(imported.resource);
			const time = resolveProgrammaticFrame({
				source: saved,
				clipStart: clip.startTime,
				clipDuration: clip.duration,
				trimStart: clip.trimStart,
				timelineTime: clip.startTime + offset,
			});
			if (!time) throw Error("Expected an active programmatic frame");
			const frame = await resolveMvResourceFrame({
				source: saved,
				frame: time,
				resources: [await load(declared)],
			});
			expect(frame.sampleTime).toBe(clip.trimStart + offset);
			expect(frame.sequenceImages).toHaveLength(1);
			const selected = frame.sequenceImages![0];
			expect(selected).toMatchObject({
				ordinal: expected,
				manifestId: declared.id,
				manifestSha256: declared.sha256,
				width: 2,
				height: 1,
				alpha: "straight",
			});
			expect(selected.resource).toEqual(fixture.manifest.frames[expected]);
			expect([...new Uint8Array((await load(selected.resource)).body)]).toEqual(
				[...fixture.files.get(selected.resource.id)!],
			);
			return frame.index;
		};
		await resolveOrdinal(0, 1);
		const beforeBoundary = await resolveOrdinal(2001, 1);
		expect(await resolveOrdinal(2002, 2)).toBe(beforeBoundary);
		await resolveOrdinal(5 * tick, 5);
		const beforeRejected = await persisted();
		const projectBefore = await host.automation.project();
		const rejected = await post("apply", {
			expectedRevision: 1,
			operations: [
				{
					kind: "update-project",
					projectId: host.automation.projectId,
					patch: { name: "MUST NOT PERSIST" },
				},
				{
					kind: "update-clip",
					clipId: "sequence-clip",
					patch: {
						editing: editing(
							sequenceSource({
								resource: imported.resource,
								sequence: "missing-sequence",
							}),
						),
					},
				},
			],
		});
		expect(rejected.status).toBe(409);
		expect(await revision()).toBe(1);
		expect(await persisted()).toBe(beforeRejected);
		expect(await host.automation.project()).toEqual(projectBefore);
		expect((await current()).source).toEqual(source);
		const changed = sequenceSource({
			resource: imported.resource,
			originSourceTicks: 1001,
			speed: 3,
		});
		await apply(1, [
			{
				kind: "update-clip",
				clipId: "sequence-clip",
				patch: {
					trimStart: 3 * tick,
					trimEnd: 49 * tick,
					editing: editing(changed),
				},
			},
		]);
		await reopen();
		expect(await revision()).toBe(2);
		expect((await current()).source).toEqual(changed);
		expect((await current()).clip).toMatchObject({
			startTime,
			duration,
			trimStart: 3 * tick,
			trimEnd: 49 * tick,
		});
		await resolveOrdinal(0, 3);
		await resolveOrdinal(tick, 4);
		await expect(stat(fixture.manifestPath)).rejects.toMatchObject({
			code: "ENOENT",
		});
	} finally {
		await host?.close();
		await fixture.cleanup();
	}
}, 30000);

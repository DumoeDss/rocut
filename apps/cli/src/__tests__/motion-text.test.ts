import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	createMotionTextSequence,
	createMotionTextVariationCandidate,
	importJizuraMotionTextProject,
	mutateMotionTextSequence,
} from "../../../../rust/wasm/pkg/opencut_wasm_sync.js";
import { startHost } from "../host";
import { runCli } from "../main";
import type { MotionTextFactoryCores } from "../motion-text";
import { TargetRegistry } from "../target-registry";

const roots: string[] = [];

async function tempRoot(): Promise<string> {
	const root = await mkdtemp(path.join(tmpdir(), "rocut-motion-text-cli-"));
	roots.push(root);
	return root;
}

afterAll(async () => {
	for (const root of roots) await rm(root, { recursive: true, force: true });
});

const canonicalCores: MotionTextFactoryCores = {
	create: createMotionTextSequence,
	importJizura: importJizuraMotionTextProject,
	mutate: mutateMotionTextSequence,
	variation: createMotionTextVariationCandidate,
};

async function captureStdout(run: () => Promise<void>): Promise<string> {
	const original = process.stdout.write.bind(process.stdout);
	let output = "";
	process.stdout.write = ((chunk: string | Uint8Array) => {
		output += Buffer.from(chunk).toString();
		return true;
	}) as typeof process.stdout.write;
	try {
		await run();
	} finally {
		process.stdout.write = original;
	}
	return output;
}

describe("motion-text host API", () => {
	test("creates, mutates, varies, imports, and reports stable conflicts through canonical Rust", async () => {
		const host = await startHost({
			projectRoot: await tempRoot(),
			registry: new TargetRegistry(await tempRoot()),
			motionTextCores: canonicalCores,
		});
		const base = `http://127.0.0.1:${host.port}/${host.token}/api`;
		const post = (route: string, body: unknown) =>
			fetch(`${base}/${route}`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			});
		try {
			const catalog = (await (
				await fetch(`${base}/motion-text/catalog`)
			).json()) as {
				counts: { total: number };
				starterPresets: string[];
			};
			expect(catalog.counts.total).toBe(889);
			expect(catalog.starterPresets).toContain("impact-title");

			const createSpec = {
				source: "LIGHTS RISE\nWE MOVE",
				sourceFormat: "plain",
				language: "en",
				duration: 360_000,
				startTime: 120_000,
				starterPreset: "impact-title",
				seed: 7,
				expectedRevision: 0,
				idempotencyKey: "test:create:lights-rise",
			};
			const createdResponse = await post("motion-text/sequences", createSpec);
			expect(createdResponse.status).toBe(200);
			const created = (await createdResponse.json()) as {
				projectRevision: number;
				sequenceRevision: number;
				sequenceId: string;
				clipId: string;
				trackId: string;
				affected: { cueIds: string[]; cutIds: string[] };
			};
			expect(created).toMatchObject({
				projectRevision: 1,
				sequenceRevision: 0,
			});
			expect(created.sequenceId).toMatch(/^motion-sequence:/u);
			expect(created.clipId).toMatch(/^motion-clip:/u);
			expect(created.trackId).toMatch(/^motion-track:/u);
			expect(created.affected.cueIds).toHaveLength(2);
			expect(created.affected.cutIds.length).toBeGreaterThan(0);

			const replay = await post("motion-text/sequences", createSpec);
			expect(replay.status).toBe(200);
			expect(await replay.json()).toMatchObject({
				projectRevision: 1,
				sequenceId: created.sequenceId,
				clipId: created.clipId,
				trackId: created.trackId,
			});

			const mutation = {
				mutation: {
					kind: "update-planning-controls",
					controls: {
						presetSets: { horror: true, typo: true, kinetic: false },
						unify: true,
						centerFree: true,
						centerDirection: "lr",
					},
				},
				expectedRevision: 1,
				expectedSequenceRevision: 0,
				idempotencyKey: "test:mutate:planning-controls",
			};
			const mutatedResponse = await post(
				`motion-text/sequences/${encodeURIComponent(created.sequenceId)}/mutations`,
				mutation,
			);
			expect(mutatedResponse.status).toBe(200);
			expect(await mutatedResponse.json()).toMatchObject({
				projectRevision: 2,
				sequenceRevision: 1,
				sequenceId: created.sequenceId,
			});
			const mutationReplay = await post(
				`motion-text/sequences/${encodeURIComponent(created.sequenceId)}/mutations`,
				mutation,
			);
			expect(mutationReplay.status).toBe(200);
			expect(await mutationReplay.json()).toMatchObject({
				replayed: true,
				projectRevision: 2,
				sequenceRevision: 1,
			});
			const reusedMutationKey = await post(
				`motion-text/sequences/${encodeURIComponent(created.sequenceId)}/mutations`,
				{
					...mutation,
					mutation: {
						...mutation.mutation,
						controls: { ...mutation.mutation.controls, unify: false },
					},
				},
			);
			expect(reusedMutationKey.status).toBe(409);
			expect(await reusedMutationKey.json()).toMatchObject({
				accepted: false,
				code: "motion-text-idempotency-conflict",
			});

			const stale = await post(
				`motion-text/sequences/${encodeURIComponent(created.sequenceId)}/mutations`,
				{
					...mutation,
					expectedRevision: 2,
					idempotencyKey: "test:mutate:stale",
				},
			);
			expect(stale.status).toBe(409);
			expect(await stale.json()).toMatchObject({
				accepted: false,
				code: "motion-text-sequence-conflict",
				expectedSequenceRevision: 0,
				actualSequenceRevision: 1,
			});

			const variation = {
				salt: 11,
				cueIds: [],
				groups: ["style", "layout", "enter"],
				expectedSequenceRevision: 1,
			};
			const previewResponse = await post(
				`motion-text/sequences/${encodeURIComponent(created.sequenceId)}/variations`,
				variation,
			);
			expect(previewResponse.status).toBe(200);
			expect(await previewResponse.json()).toMatchObject({
				applied: false,
				projectRevision: 2,
				baseSequenceRevision: 1,
				candidateSequenceRevision: 2,
			});

			const appliedVariation = await post(
				`motion-text/sequences/${encodeURIComponent(created.sequenceId)}/variations?apply=true`,
				{
					...variation,
					expectedRevision: 2,
					idempotencyKey: "test:vary:apply",
				},
			);
			expect(appliedVariation.status).toBe(200);
			expect(await appliedVariation.json()).toMatchObject({
				applied: true,
				projectRevision: 3,
				baseSequenceRevision: 1,
				sequenceRevision: 2,
			});
			const variationReplay = await post(
				`motion-text/sequences/${encodeURIComponent(created.sequenceId)}/variations?apply=true`,
				{
					...variation,
					expectedRevision: 2,
					idempotencyKey: "test:vary:apply",
				},
			);
			expect(variationReplay.status).toBe(200);
			expect(await variationReplay.json()).toMatchObject({
				replayed: true,
				projectRevision: 3,
				sequenceRevision: 2,
			});

			const jizuraSource = await readFile(
				path.resolve(
					import.meta.dir,
					"../../../../rust/crates/motion-text/fixtures/jizura-v1-project.json",
				),
				"utf8",
			);
			const importedResponse = await post("motion-text/sequences", {
				source: jizuraSource,
				sourceFormat: "jizura",
				startTime: 0,
				expectedRevision: 3,
				idempotencyKey: "test:create:jizura-import",
			});
			expect(importedResponse.status).toBe(200);
			expect(await importedResponse.json()).toMatchObject({
				projectRevision: 4,
				sequenceRevision: 0,
				compatibilityReport: {
					status: "imported-with-warnings",
				},
			});

			const sequences = (await (
				await fetch(`${base}/motion-text-sequences`)
			).json()) as { id: string; revision: number }[];
			expect(sequences).toHaveLength(2);
			expect(
				sequences.find((entry) => entry.id === created.sequenceId)?.revision,
			).toBe(2);
			expect(await host.automation.revision()).toBe(4);
		} finally {
			await host.close();
		}
	});
});

describe("motion-text CLI", () => {
	test("drives the full high-level workflow and reads back stable revisions", async () => {
		const projectRoot = await tempRoot();
		const targetsRoot = await tempRoot();
		const host = await startHost({
			projectRoot,
			registry: new TargetRegistry(targetsRoot),
			motionTextCores: canonicalCores,
		});
		const specPath = path.join(await tempRoot(), "create.json");
		await writeFile(
			specPath,
			JSON.stringify({
				source: "Agent title",
				sourceFormat: "plain",
				language: "en",
				duration: 120_000,
				expectedRevision: 0,
				idempotencyKey: "test:cli:create",
			}),
			"utf8",
		);
		try {
			const catalogOutput = JSON.parse(
				await captureStdout(() =>
					runCli(["motion-text", "catalog", "--targets-root", targetsRoot]),
				),
			) as {
				catalog: { counts: { total: number }; starterPresets: string[] };
			};
			expect(catalogOutput.catalog.counts.total).toBe(889);
			expect(catalogOutput.catalog.starterPresets).toContain("clean-caption");

			const createOutput = JSON.parse(
				await captureStdout(() =>
					runCli([
						"motion-text",
						"create",
						specPath,
						"--targets-root",
						targetsRoot,
					]),
				),
			) as {
				projectRevision: number;
				sequenceRevision: number;
				sequenceId: string;
				clipId: string;
				trackId: string;
			};
			expect(createOutput).toMatchObject({
				projectRevision: 1,
				sequenceRevision: 0,
			});

			const firstList = JSON.parse(
				await captureStdout(() =>
					runCli(["motion-text", "list", "--targets-root", targetsRoot]),
				),
			) as {
				projectRevision: number;
				sequences: { id: string; revision: number }[];
			};
			expect(firstList).toMatchObject({ projectRevision: 1 });
			expect(firstList.sequences).toContainEqual(
				expect.objectContaining({ id: createOutput.sequenceId, revision: 0 }),
			);

			const mutationPath = path.join(await tempRoot(), "mutation.json");
			await writeFile(
				mutationPath,
				JSON.stringify({
					mutation: {
						kind: "update-planning-controls",
						controls: {
							presetSets: { horror: false, typo: true, kinetic: true },
							unify: true,
							centerFree: true,
							centerDirection: "tb",
						},
					},
					expectedRevision: 1,
					expectedSequenceRevision: 0,
					idempotencyKey: "test:cli:mutate",
				}),
				"utf8",
			);
			const mutationOutput = JSON.parse(
				await captureStdout(() =>
					runCli([
						"motion-text",
						"mutate",
						createOutput.sequenceId,
						mutationPath,
						"--targets-root",
						targetsRoot,
					]),
				),
			) as { projectRevision: number; sequenceRevision: number };
			expect(mutationOutput).toMatchObject({
				projectRevision: 2,
				sequenceRevision: 1,
			});

			const variationPath = path.join(await tempRoot(), "variation.json");
			await writeFile(
				variationPath,
				JSON.stringify({
					salt: 29,
					cueIds: [],
					groups: ["style", "layout", "enter"],
					expectedSequenceRevision: 1,
				}),
				"utf8",
			);
			const previewOutput = JSON.parse(
				await captureStdout(() =>
					runCli([
						"motion-text",
						"vary",
						createOutput.sequenceId,
						variationPath,
						"--targets-root",
						targetsRoot,
					]),
				),
			) as {
				applied: boolean;
				projectRevision: number;
				baseSequenceRevision: number;
				candidateSequenceRevision: number;
			};
			expect(previewOutput).toMatchObject({
				applied: false,
				projectRevision: 2,
				baseSequenceRevision: 1,
				candidateSequenceRevision: 2,
			});
			const afterPreview = JSON.parse(
				await captureStdout(() =>
					runCli(["motion-text", "list", "--targets-root", targetsRoot]),
				),
			) as {
				projectRevision: number;
				sequences: { id: string; revision: number }[];
			};
			expect(afterPreview.projectRevision).toBe(2);
			expect(afterPreview.sequences[0]?.revision).toBe(1);

			const applyVariationPath = path.join(
				await tempRoot(),
				"apply-variation.json",
			);
			await writeFile(
				applyVariationPath,
				JSON.stringify({
					salt: 29,
					cueIds: [],
					groups: ["style", "layout", "enter"],
					expectedRevision: 2,
					expectedSequenceRevision: 1,
					idempotencyKey: "test:cli:vary:apply",
				}),
				"utf8",
			);
			const appliedOutput = JSON.parse(
				await captureStdout(() =>
					runCli([
						"motion-text",
						"vary",
						createOutput.sequenceId,
						applyVariationPath,
						"--apply",
						"--targets-root",
						targetsRoot,
					]),
				),
			) as {
				applied: boolean;
				projectRevision: number;
				sequenceRevision: number;
			};
			expect(appliedOutput).toMatchObject({
				applied: true,
				projectRevision: 3,
				sequenceRevision: 2,
			});

			const readOutput = JSON.parse(
				await captureStdout(() =>
					runCli(["read", "--targets-root", targetsRoot]),
				),
			) as {
				motionTextSequences: number;
				revision: number;
				entities: {
					tracks: { id: string }[];
					clips: { id: string }[];
					motionTextSequences: { id: string; revision: number }[];
				};
			};
			expect(readOutput.revision).toBe(3);
			expect(readOutput.motionTextSequences).toBe(1);
			expect(readOutput.entities.tracks.map((entry) => entry.id)).toContain(
				createOutput.trackId,
			);
			expect(readOutput.entities.clips.map((entry) => entry.id)).toContain(
				createOutput.clipId,
			);
			expect(readOutput.entities.motionTextSequences).toContainEqual(
				expect.objectContaining({ id: createOutput.sequenceId, revision: 2 }),
			);
		} finally {
			await host.close();
		}
	});
});

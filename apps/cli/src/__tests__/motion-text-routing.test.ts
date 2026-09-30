import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { projectId, type MotionTextSequence } from "@opencut/editor-contracts";
import {
	createOpenCutProjectRecord,
	CURRENT_PROJECT_VERSION,
} from "@opencut/editor-classic/transactions";
import type { ProjectRecord } from "@opencut/editor-ports";
import {
	createMotionTextSequence,
	createMotionTextVariationCandidate,
	importJizuraMotionTextProject,
	mutateMotionTextSequence,
} from "../../../../rust/wasm/pkg/opencut_wasm_sync.js";
import { FileProjectStore } from "../file-store";
import { startHost } from "../host";
import { runCli } from "../main";
import type { MotionTextFactoryCores } from "../motion-text";
import { TargetRegistry } from "../target-registry";

const roots: string[] = [];

async function tempRoot(prefix: string): Promise<string> {
	const root = await mkdtemp(path.join(tmpdir(), prefix));
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

async function jsonFile(name: string, value: unknown): Promise<string> {
	const file = path.join(await tempRoot("rocut-motion-routing-input-"), name);
	await writeFile(file, JSON.stringify(value), "utf8");
	return file;
}

async function seedLegacyProject(
	root: string,
	marker: string,
): Promise<{ id: ReturnType<typeof projectId>; store: FileProjectStore }> {
	const id = projectId(path.basename(root).replace(/[^A-Za-z0-9._-]/gu, "-"));
	const store = new FileProjectStore({
		root,
		schemaVersion: CURRENT_PROJECT_VERSION,
	});
	const seed = createOpenCutProjectRecord({
		projectId: id,
		name: `Legacy ${marker}`,
	});
	const data = {
		...(seed.record.data as Record<string, unknown>),
		version: 31,
		providerExtension: { marker, preserve: true },
	};
	delete data.motionTextSequences;
	const record: ProjectRecord = {
		...seed.record,
		schemaVersion: 31,
		data,
	};
	await store.save({ record, summary: seed.summary });
	return { id, store };
}

async function runJson(
	argv: readonly string[],
): Promise<Record<string, unknown>> {
	return JSON.parse(await captureStdout(() => runCli(argv))) as Record<
		string,
		unknown
	>;
}

describe("motion-text project routing", () => {
	test("isolates multilingual sequences and revisions across concurrent hosts", async () => {
		const targetsRoot = await tempRoot("rocut-motion-routing-targets-");
		const registry = new TargetRegistry(targetsRoot);
		const projectA = await tempRoot("rocut-motion-routing-zh-");
		const projectB = await tempRoot("rocut-motion-routing-ja-");
		const hostA = await startHost({
			projectRoot: projectA,
			registry,
			motionTextCores: canonicalCores,
		});
		const hostB = await startHost({
			projectRoot: projectB,
			registry,
			motionTextCores: canonicalCores,
		});
		const sharedIntent = {
			sourceFormat: "plain",
			duration: 180_000,
			expectedRevision: 0,
			idempotencyKey: "test:cross-project:shared-key",
		};
		const chineseSpec = await jsonFile("zh.json", {
			...sharedIntent,
			source: "城里的光",
			language: "zh-Hans",
		});
		const japaneseSpec = await jsonFile("ja.json", {
			...sharedIntent,
			source: "街の光",
			language: "ja",
		});
		try {
			const createdA = await runJson([
				"motion-text",
				"create",
				chineseSpec,
				"--project",
				projectA,
				"--targets-root",
				targetsRoot,
			]);
			const createdB = await runJson([
				"motion-text",
				"create",
				japaneseSpec,
				"--project",
				projectB,
				"--targets-root",
				targetsRoot,
			]);
			expect(createdA).toMatchObject({
				projectRevision: 1,
				sequenceRevision: 0,
			});
			expect(createdB).toMatchObject({
				projectRevision: 1,
				sequenceRevision: 0,
			});
			expect(createdA.sequenceId).toBe(createdB.sequenceId);

			const list = async (project: string) => {
				const result = await runJson([
					"motion-text",
					"list",
					"--project",
					project,
					"--targets-root",
					targetsRoot,
				]);
				return result as unknown as {
					target: string;
					projectRevision: number;
					sequences: MotionTextSequence[];
				};
			};
			const beforeA = await list(projectA);
			const beforeB = await list(projectB);
			expect(beforeA.target).not.toBe(beforeB.target);
			expect(beforeA.sequences[0]).toMatchObject({
				language: "zh-Hans",
				revision: 0,
			});
			expect(beforeA.sequences[0]?.cues[0]?.text).toBe("城里的光");
			expect(beforeB.sequences[0]).toMatchObject({
				language: "ja",
				revision: 0,
			});
			expect(beforeB.sequences[0]?.cues[0]?.text).toBe("街の光");

			const mutation = await jsonFile("mutation.json", {
				mutation: {
					kind: "update-planning-controls",
					controls: {
						presetSets: { horror: false, typo: true, kinetic: true },
						unify: true,
						centerFree: false,
						centerDirection: "tb",
					},
				},
				expectedRevision: 1,
				expectedSequenceRevision: 0,
				idempotencyKey: "test:cross-project:mutate-a",
			});
			await runJson([
				"motion-text",
				"mutate",
				String(createdA.sequenceId),
				mutation,
				"--project",
				projectA,
				"--targets-root",
				targetsRoot,
			]);

			const afterA = await list(projectA);
			const afterB = await list(projectB);
			expect(afterA.projectRevision).toBe(2);
			expect(afterA.sequences[0]).toMatchObject({
				revision: 1,
				planningControls: { unify: true },
			});
			expect(afterB.projectRevision).toBe(1);
			expect(afterB.sequences[0]).toMatchObject({
				revision: 0,
				language: "ja",
			});
		} finally {
			await hostB.close();
			await hostA.close();
		}
	});

	test("migrates and reopens two multilingual projects without shared state", async () => {
		const targetsRoot = await tempRoot("rocut-motion-upgrade-targets-");
		const registry = new TargetRegistry(targetsRoot);
		const projectA = await tempRoot("rocut-motion-upgrade-zh-");
		const projectB = await tempRoot("rocut-motion-upgrade-ja-");
		const [legacyA, legacyB] = await Promise.all([
			seedLegacyProject(projectA, "zh-provider"),
			seedLegacyProject(projectB, "ja-provider"),
		]);
		const sharedIntent = {
			sourceFormat: "plain",
			duration: 180_000,
			expectedRevision: 0,
			idempotencyKey: "test:upgrade-routing:shared-key",
		};
		const chineseSpec = await jsonFile("upgrade-zh.json", {
			...sharedIntent,
			source: "升级后的城",
			language: "zh-Hans",
		});
		const japaneseSpec = await jsonFile("upgrade-ja.json", {
			...sharedIntent,
			source: "更新後の街",
			language: "ja",
		});
		let createdA: Record<string, unknown>;
		let createdB: Record<string, unknown>;

		const hostA = await startHost({
			projectRoot: projectA,
			registry,
			motionTextCores: canonicalCores,
		});
		const hostB = await startHost({
			projectRoot: projectB,
			registry,
			motionTextCores: canonicalCores,
		});
		try {
			createdA = await runJson([
				"motion-text",
				"create",
				chineseSpec,
				"--project",
				projectA,
				"--targets-root",
				targetsRoot,
			]);
			createdB = await runJson([
				"motion-text",
				"create",
				japaneseSpec,
				"--project",
				projectB,
				"--targets-root",
				targetsRoot,
			]);
			expect(createdA).toMatchObject({
				projectRevision: 1,
				sequenceRevision: 0,
			});
			expect(createdB).toMatchObject({
				projectRevision: 1,
				sequenceRevision: 0,
			});

			for (const legacy of [legacyA, legacyB]) {
				const migrated = await legacy.store.load({ id: legacy.id });
				expect(migrated?.schemaVersion).toBe(CURRENT_PROJECT_VERSION);
				expect(migrated?.data).toMatchObject({
					version: CURRENT_PROJECT_VERSION,
					motionTextSequences: [expect.any(Object)],
				});
			}
			expect(
				(await legacyA.store.load({ id: legacyA.id }))?.data,
			).toMatchObject({
				providerExtension: { marker: "zh-provider", preserve: true },
			});
			expect(
				(await legacyB.store.load({ id: legacyB.id }))?.data,
			).toMatchObject({
				providerExtension: { marker: "ja-provider", preserve: true },
			});
		} finally {
			await Promise.all([hostA.close(), hostB.close()]);
		}

		const reopenedA = await startHost({
			projectRoot: projectA,
			registry,
			motionTextCores: canonicalCores,
		});
		const reopenedB = await startHost({
			projectRoot: projectB,
			registry,
			motionTextCores: canonicalCores,
		});
		try {
			const sequencesA =
				(await reopenedA.automation.motionTextSequences?.()) ?? [];
			const sequencesB =
				(await reopenedB.automation.motionTextSequences?.()) ?? [];
			expect(sequencesA).toHaveLength(1);
			expect(sequencesB).toHaveLength(1);
			expect(sequencesA[0]).toMatchObject({
				id: createdA.sequenceId,
				language: "zh-Hans",
				revision: 0,
				cues: [{ text: "升级后的城" }],
			});
			expect(sequencesB[0]).toMatchObject({
				id: createdB.sequenceId,
				language: "ja",
				revision: 0,
				cues: [{ text: "更新後の街" }],
			});

			const replayA = await runJson([
				"motion-text",
				"create",
				chineseSpec,
				"--project",
				projectA,
				"--targets-root",
				targetsRoot,
			]);
			expect(replayA).toMatchObject({
				sequenceId: createdA.sequenceId,
				projectRevision: 1,
				sequenceRevision: 0,
			});
			expect(await reopenedA.automation.revision()).toBe(1);
			expect(await reopenedB.automation.revision()).toBe(1);
		} finally {
			await Promise.all([reopenedA.close(), reopenedB.close()]);
		}
	});
});

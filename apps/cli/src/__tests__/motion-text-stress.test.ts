import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { MotionTextSequence } from "@opencut/editor-contracts";
import {
	createMotionTextSequence,
	createMotionTextVariationCandidate,
	importJizuraMotionTextProject,
	mutateMotionTextSequence,
} from "../../../../rust/wasm/pkg/opencut_wasm_sync.js";
import { startHost, type RunningHost } from "../host";
import type { MotionTextFactoryCores } from "../motion-text";
import { TargetRegistry } from "../target-registry";

const TICKS_PER_SECOND = 120_000;
const roots: string[] = [];

async function tempRoot(): Promise<string> {
	const root = await mkdtemp(path.join(tmpdir(), "rocut-motion-text-stress-"));
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

function sourceFor(id: string, cueCount: number): string {
	return Array.from(
		{ length: cueCount },
		(_, index) =>
			`${id} LINE ${String(index + 1).padStart(3, "0")} STRESS SAMPLE`,
	).join("\n");
}

function digest(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function sequences(host: RunningHost): Promise<MotionTextSequence[]> {
	return (await (
		await fetch(
			`http://127.0.0.1:${host.port}/${host.token}/api/motion-text-sequences`,
		)
	).json()) as MotionTextSequence[];
}

describe("motion-text F04/F05 durable stress", () => {
	test("persists and reopens 120- and 600-cue canonical sequences without identity drift", async () => {
		const projectRoot = await tempRoot();
		const targetsRoot = await tempRoot();
		const registry = new TargetRegistry(targetsRoot);
		let host = await startHost({
			projectRoot,
			registry,
			motionTextCores: canonicalCores,
		});
		const fixtures = [
			{
				id: "F04",
				cueCount: 120,
				duration: 3 * 60 * TICKS_PER_SECOND,
				expectedRevision: 0,
			},
			{
				id: "F05",
				cueCount: 600,
				duration: 8 * 60 * TICKS_PER_SECOND,
				expectedRevision: 1,
			},
		] as const;
		try {
			const created = [];
			for (const fixture of fixtures) {
				const response = await fetch(
					`http://127.0.0.1:${host.port}/${host.token}/api/motion-text/sequences`,
					{
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							source: sourceFor(fixture.id, fixture.cueCount),
							sourceFormat: "plain",
							language: "en",
							duration: fixture.duration,
							starterPreset: "clean-caption",
							seed: fixture.cueCount,
							expectedRevision: fixture.expectedRevision,
							idempotencyKey: `test:stress:${fixture.id}`,
						}),
					},
				);
				expect(response.status).toBe(200);
				created.push(
					(await response.json()) as {
						projectRevision: number;
						sequenceId: string;
						sequenceRevision: number;
					},
				);
			}
			expect(created.map((entry) => entry.projectRevision)).toEqual([1, 2]);
			expect(created.map((entry) => entry.sequenceRevision)).toEqual([0, 0]);

			const before = await sequences(host);
			expect(before).toHaveLength(2);
			for (const [index, fixture] of fixtures.entries()) {
				const sequence = before.find(
					(entry) => entry.id === created[index]?.sequenceId,
				);
				expect(sequence?.cues).toHaveLength(fixture.cueCount);
				expect(sequence?.resolvedPlan?.cuts.length).toBe(fixture.cueCount * 2);
				expect(sequence?.duration).toBe(fixture.duration);
			}
			const beforeDigest = digest(before);
			await host.close();

			host = await startHost({
				projectRoot,
				registry,
				motionTextCores: canonicalCores,
			});
			const reopened = await sequences(host);
			expect(digest(reopened)).toBe(beforeDigest);
			expect(await host.automation.revision()).toBe(2);

			const replay = await fetch(
				`http://127.0.0.1:${host.port}/${host.token}/api/motion-text/sequences`,
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						source: sourceFor("F05", 600),
						sourceFormat: "plain",
						language: "en",
						duration: 8 * 60 * TICKS_PER_SECOND,
						starterPreset: "clean-caption",
						seed: 600,
						expectedRevision: 1,
						idempotencyKey: "test:stress:F05",
					}),
				},
			);
			expect(replay.status).toBe(200);
			const replayPayload = (await replay.json()) as {
				projectRevision: number;
				sequenceId: string;
			};
			expect(replayPayload.projectRevision).toBe(2);
			expect(replayPayload.sequenceId).toBe(created[1]?.sequenceId);
			expect(await host.automation.revision()).toBe(2);
			expect(digest(await sequences(host))).toBe(beforeDigest);
			expect(
				(await stat(path.join(projectRoot, "project.json"))).size,
			).toBeLessThan(16 * 1024 * 1024);
		} finally {
			await host.close();
		}
	});
});

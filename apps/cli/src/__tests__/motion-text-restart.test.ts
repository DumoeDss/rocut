import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	createMotionTextSequence,
	createMotionTextVariationCandidate,
	importJizuraMotionTextProject,
	mutateMotionTextSequence,
} from "../../../../rust/wasm/pkg/opencut_wasm_sync.js";
import { startHost, type RunningHost } from "../host";
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

async function openHost(projectRoot: string): Promise<RunningHost> {
	return startHost({
		projectRoot,
		registry: new TargetRegistry(
			await tempRoot("rocut-motion-restart-targets-"),
		),
		motionTextCores: canonicalCores,
	});
}

function post(host: RunningHost, route: string, body: unknown) {
	return fetch(`http://127.0.0.1:${host.port}/${host.token}/api/${route}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

describe("motion-text host restart semantics", () => {
	test("durably replays create and rejects a late mutation retry for read-back", async () => {
		const projectRoot = await tempRoot("rocut-motion-restart-project-");
		const createSpec = {
			source: "REOPEN THE LIGHT",
			sourceFormat: "plain",
			language: "en",
			duration: 240_000,
			expectedRevision: 0,
			idempotencyKey: "test:restart:create",
		};

		const firstHost = await openHost(projectRoot);
		let created: {
			sequenceId: string;
			clipId: string;
			trackId: string;
		};
		try {
			const response = await post(
				firstHost,
				"motion-text/sequences",
				createSpec,
			);
			expect(response.status).toBe(200);
			created = (await response.json()) as typeof created;
			expect(created.sequenceId).toMatch(/^motion-sequence:/u);
			expect(await firstHost.automation.revision()).toBe(1);
		} finally {
			await firstHost.close();
		}

		const secondHost = await openHost(projectRoot);
		const mutation = {
			mutation: {
				kind: "update-planning-controls",
				controls: {
					presetSets: { horror: false, typo: true, kinetic: true },
					unify: true,
					centerFree: true,
					centerDirection: "lr",
				},
			},
			expectedRevision: 1,
			expectedSequenceRevision: 0,
			idempotencyKey: "test:restart:mutate",
		};
		try {
			const replay = await post(
				secondHost,
				"motion-text/sequences",
				createSpec,
			);
			expect(replay.status).toBe(200);
			expect(await replay.json()).toMatchObject({
				projectRevision: 1,
				sequenceRevision: 0,
				sequenceId: created.sequenceId,
				clipId: created.clipId,
				trackId: created.trackId,
			});
			expect(await secondHost.automation.revision()).toBe(1);
			expect(await secondHost.automation.motionTextSequences?.()).toHaveLength(
				1,
			);

			const mutated = await post(
				secondHost,
				`motion-text/sequences/${encodeURIComponent(created.sequenceId)}/mutations`,
				mutation,
			);
			expect(mutated.status).toBe(200);
			expect(await mutated.json()).toMatchObject({
				projectRevision: 2,
				sequenceRevision: 1,
			});
		} finally {
			await secondHost.close();
		}

		const thirdHost = await openHost(projectRoot);
		try {
			const lateRetry = await post(
				thirdHost,
				`motion-text/sequences/${encodeURIComponent(created.sequenceId)}/mutations`,
				mutation,
			);
			expect(lateRetry.status).toBe(409);
			expect(await lateRetry.json()).toMatchObject({
				accepted: false,
				code: "motion-text-sequence-conflict",
				expectedSequenceRevision: 0,
				actualSequenceRevision: 1,
			});
			expect(await thirdHost.automation.revision()).toBe(2);
			const sequences =
				(await thirdHost.automation.motionTextSequences?.()) ?? [];
			expect(sequences).toHaveLength(1);
			expect(sequences[0]).toMatchObject({
				id: created.sequenceId,
				revision: 1,
				planningControls: { unify: true },
			});
		} finally {
			await thirdHost.close();
		}
	});
});

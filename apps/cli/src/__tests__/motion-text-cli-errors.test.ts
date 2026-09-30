import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	createMotionTextSequence,
	createMotionTextVariationCandidate,
	importJizuraMotionTextProject,
	mutateMotionTextSequence,
} from "../../../../rust/wasm/pkg/opencut_wasm_sync.js";
import { startHost } from "../host";
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

describe("motion-text CLI error contract", () => {
	test("prints a human line and structured conflict details", async () => {
		const targetsRoot = await tempRoot("rocut-motion-error-targets-");
		const host = await startHost({
			projectRoot: await tempRoot("rocut-motion-error-project-"),
			registry: new TargetRegistry(targetsRoot),
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
			const created = (await (
				await post("motion-text/sequences", {
					source: "CONFLICT",
					sourceFormat: "plain",
					language: "en",
					duration: 120_000,
					expectedRevision: 0,
					idempotencyKey: "test:cli:error:create",
				})
			).json()) as { sequenceId: string };
			const firstMutation = {
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
				idempotencyKey: "test:cli:error:first-mutation",
			};
			const committed = await post(
				`motion-text/sequences/${encodeURIComponent(created.sequenceId)}/mutations`,
				firstMutation,
			);
			expect(committed.status).toBe(200);

			const stalePath = path.join(
				await tempRoot("rocut-motion-error-input-"),
				"stale.json",
			);
			await writeFile(
				stalePath,
				JSON.stringify({
					...firstMutation,
					expectedRevision: 2,
					idempotencyKey: "test:cli:error:stale",
				}),
				"utf8",
			);
			const processHandle = Bun.spawn({
				cmd: [
					process.execPath,
					path.resolve(import.meta.dir, "../main.ts"),
					"motion-text",
					"mutate",
					created.sequenceId,
					stalePath,
					"--targets-root",
					targetsRoot,
				],
				stdout: "pipe",
				stderr: "pipe",
			});
			const [exitCode, stdout, stderr] = await Promise.all([
				processHandle.exited,
				new Response(processHandle.stdout).text(),
				new Response(processHandle.stderr).text(),
			]);
			expect(exitCode).toBe(1);
			expect(stdout).toBe("");
			const lines = stderr.trim().split(/\r?\n/u);
			expect(lines[0]).toContain("rocut: POST /motion-text/sequences/");
			expect(lines[0]).toContain("failed (409)");
			const details = JSON.parse(lines[1] ?? "null") as {
				httpStatus: number;
				method: string;
				response: {
					code: string;
					expectedSequenceRevision: number;
					actualSequenceRevision: number;
				};
			};
			expect(details).toMatchObject({
				httpStatus: 409,
				method: "POST",
				response: {
					code: "motion-text-sequence-conflict",
					expectedSequenceRevision: 0,
					actualSequenceRevision: 1,
				},
			});
		} finally {
			await host.close();
		}
	});
});

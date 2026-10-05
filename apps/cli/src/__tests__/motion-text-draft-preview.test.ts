import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { MotionTextSequence } from "@opencut/editor-contracts";
import {
	createMotionTextSequence,
	mutateMotionTextSequence,
} from "../../../../rust/wasm/pkg/opencut_wasm_sync.js";
import { startHost } from "../host";
import { runCli } from "../main";
import { TargetRegistry } from "../target-registry";

const roots: string[] = [];
async function tempRoot() {
	const root = await mkdtemp(path.join(tmpdir(), "rocut-motion-draft-"));
	roots.push(root);
	return root;
}
afterAll(async () => {
	for (const root of roots) await rm(root, { recursive: true, force: true });
});

async function fixture() {
	const targetsRoot = await tempRoot();
	const projectRoot = await tempRoot();
	const host = await startHost({
		projectRoot,
		registry: new TargetRegistry(targetsRoot),
		motionTextCores: {
			create: createMotionTextSequence,
			mutate: mutateMotionTextSequence,
		},
	});
	const base = "http://127.0.0.1:" + host.port + "/" + host.token + "/api";
	const post = (route: string, body?: unknown) =>
		fetch(base + "/" + route, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body ?? {}),
		});
	const created = (await (
		await post("motion-text/sequences", {
			source: "First line\nSecond line",
			sourceFormat: "plain",
			language: "en",
			duration: 360000,
			expectedRevision: 0,
			idempotencyKey: "create",
		})
	).json()) as { sequenceId: string };
	const sequences = () =>
		fetch(base + "/motion-text-sequences").then((response) =>
			response.json(),
		) as Promise<MotionTextSequence[]>;
	const original = (await sequences())[0];
	const spec = {
		mutation: {
			kind: "update-cue",
			cueId: original.cues[1].id,
			text: "Draft only",
			startTime: original.cues[1].startTime,
			duration: original.cues[1].duration,
			preset: { mode: "keep" },
			font: { mode: "keep" },
			colors: { mode: "keep" },
		},
		expectedRevision: 1,
		expectedSequenceRevision: 0,
		idempotencyKey: "preview-then-apply",
	};
	return {
		host,
		post,
		sequences,
		original,
		spec,
		projectRoot,
		targetsRoot,
		route:
			"motion-text/sequences/" +
			encodeURIComponent(created.sequenceId) +
			"/mutations",
	};
}

describe("motion-text mutation preview for manual drafts", () => {
	test("Rust candidate remains uncommitted until the generic draft is approved", async () => {
		const f = await fixture();
		try {
			const before = await f.sequences();
			const response = await f.post(
				f.route.replace("/mutations", "/mutation-previews"),
				f.spec,
			);
			expect(response.status).toBe(200);
			const preview = (await response.json()) as {
				candidate: MotionTextSequence;
			};
			expect(preview).toMatchObject({
				applied: false,
				projectRevision: 1,
				baseSequenceRevision: 0,
				candidateSequenceRevision: 1,
			});
			expect(await f.sequences()).toEqual(before);
			expect(await f.host.automation.revision()).toBe(1);
			expect(preview.candidate.cues[1].text).toBe("Draft only");
			expect(
				preview.candidate.resolvedPlan.cuts
					.filter((cut) => cut.cueId === f.original.cues[1].id)
					.map((cut) => cut.text)
					.join(" "),
			).toBe("Draft only");
			const { draftId } = (await (
				await f.post("drafts", { approvalMode: "manual" })
			).json()) as { draftId: string };
			const route = "drafts/" + draftId;
			const staged = await (
				await f.post(route + "/stage", {
					operations: [
						{
							kind: "update-motion-text-sequence",
							sequenceId: f.original.id,
							expectedSequenceRevision: f.original.revision,
							sequence: preview.candidate,
						},
					],
				})
			).json();
			expect(staged).toMatchObject({ accepted: true });
			expect(await f.sequences()).toEqual(before);
			expect(await (await f.post(route + "/approve")).json()).toMatchObject({
				applied: true,
			});
			expect((await f.sequences())[0]).toEqual(preview.candidate);
			expect(await f.host.automation.revision()).toBe(2);
		} finally {
			await f.host.close();
		}
	});
	test("preview needs no write key, validates sequence revision, and does not poison mutation idempotency", async () => {
		const f = await fixture();
		try {
			const minimal = {
				mutation: f.spec.mutation,
				expectedSequenceRevision: 0,
			};
			expect(
				(
					await f.post(
						f.route.replace("/mutations", "/mutation-previews"),
						minimal,
					)
				).status,
			).toBe(200);
			expect((await f.post(f.route, minimal)).status).toBe(400);
			expect(
				(
					await f.post(
						f.route.replace("/mutations", "/mutation-previews"),
						f.spec,
					)
				).status,
			).toBe(200);
			const applied = await (await f.post(f.route, f.spec)).json();
			expect(applied).toMatchObject({
				projectRevision: 2,
				sequenceRevision: 1,
			});
			expect(await (await f.post(f.route, f.spec)).json()).toMatchObject({
				replayed: true,
				projectRevision: 2,
			});
			const stale = await f.post(
				f.route.replace("/mutations", "/mutation-previews"),
				f.spec,
			);
			expect(stale.status).toBe(409);
			expect(await stale.json()).toMatchObject({
				code: "motion-text-sequence-conflict",
			});
			expect(await f.host.automation.revision()).toBe(2);
		} finally {
			await f.host.close();
		}
	});
	test("CLI --preview forwards a read-only request without applying the candidate", async () => {
		const f = await fixture();
		const write = process.stdout.write.bind(process.stdout);
		let output = "";
		try {
			const specPath = path.join(f.projectRoot, "preview.json");
			await writeFile(
				specPath,
				JSON.stringify({
					mutation: f.spec.mutation,
					expectedSequenceRevision: 0,
				}),
			);
			process.stdout.write = ((chunk: string | Uint8Array) => {
				output += Buffer.from(chunk).toString();
				return true;
			}) as typeof process.stdout.write;
			await runCli([
				"motion-text",
				"mutate",
				f.original.id,
				specPath,
				"--preview",
				"--project",
				f.projectRoot,
				"--targets-root",
				f.targetsRoot,
			]);
			expect(JSON.parse(output)).toMatchObject({
				applied: false,
				candidateSequenceRevision: 1,
			});
			expect(await f.host.automation.revision()).toBe(1);
			expect((await f.sequences())[0]).toEqual(f.original);
		} finally {
			process.stdout.write = write;
			await f.host.close();
		}
	});
});

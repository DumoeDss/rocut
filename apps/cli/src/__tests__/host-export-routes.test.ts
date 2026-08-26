/**
 * Export ROUTES over the real loopback host — the wiring the registry unit
 * tests cannot reach: that `api/export/*` is actually mounted behind the token,
 * and that with no pane attached the host REFUSES up front.
 *
 * Why nothing here drives a real render: attaching a pane means consuming the
 * `api/events` SSE stream, and bun's HTTP client cannot read this host's own
 * streaming responses (the same limitation that forced `revisionEventWriter` to
 * be extracted for testing — see its docstring). So the attached-pane path is
 * covered by `host-export.test.ts` against the registry directly, and this file
 * covers the HTTP surface and the unattached refusal, which is the branch an
 * agent actually hits first.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { startHost } from "../host";
import { TargetRegistry } from "../target-registry";

const roots: string[] = [];

async function tempRoot(): Promise<string> {
	const root = await mkdtemp(path.join(tmpdir(), "rocut-export-routes-"));
	roots.push(root);
	return root;
}

afterAll(async () => {
	for (const root of roots) await rm(root, { recursive: true, force: true });
});

describe("export routes (host)", () => {
	test("refuses with 409 when no editor pane is attached, and says why", async () => {
		const projectRoot = await tempRoot();
		const host = await startHost({
			projectRoot,
			registry: new TargetRegistry(await tempRoot()),
		});
		try {
			const api = `http://127.0.0.1:${host.port}/${host.token}/api`;

			// Nothing attached: the host has no renderer to borrow.
			const listed = (await (await fetch(`${api}/export`)).json()) as {
				surfaces: number;
				jobs: unknown[];
			};
			expect(listed.surfaces).toBe(0);
			expect(listed.jobs).toEqual([]);

			const started = await fetch(`${api}/export`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ format: "mp4", quality: "high" }),
			});
			expect(started.status).toBe(409);
			const body = (await started.json()) as { code: string; error: string };
			expect(body.code).toBe("no-surface-attached");
			expect(body.error).toContain("no editor pane is attached");

			// A refusal must not leave a job behind, nor create the output dir.
			const after = (await (await fetch(`${api}/export`)).json()) as {
				jobs: unknown[];
			};
			expect(after.jobs).toEqual([]);
			expect(existsSync(path.join(projectRoot, "exports"))).toBe(false);
		} finally {
			await host.close();
		}
	});

	test("rejects malformed options with 400 before touching the pane registry", async () => {
		const host = await startHost({
			projectRoot: await tempRoot(),
			registry: new TargetRegistry(await tempRoot()),
		});
		try {
			const api = `http://127.0.0.1:${host.port}/${host.token}/api`;
			const response = await fetch(`${api}/export`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ format: "mkv" }),
			});
			// 400, not the 409 refusal: the request is wrong on its own terms,
			// independently of whether a pane happens to be attached.
			expect(response.status).toBe(400);
			expect(((await response.json()) as { error: string }).error).toContain(
				"format must be one of",
			);
		} finally {
			await host.close();
		}
	});

	test("unknown job ids 404 on every verb rather than inventing a job", async () => {
		const host = await startHost({
			projectRoot: await tempRoot(),
			registry: new TargetRegistry(await tempRoot()),
		});
		try {
			const api = `http://127.0.0.1:${host.port}/${host.token}/api`;
			expect((await fetch(`${api}/export/nope`)).status).toBe(404);
			expect(
				(
					await fetch(`${api}/export/nope/progress`, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ progress: 0.5 }),
					})
				).status,
			).toBe(404);
			expect(
				(await fetch(`${api}/export/nope/cancel`, { method: "POST" })).status,
			).toBe(404);
			expect(
				(
					await fetch(`${api}/export/nope/result?error=boom`, {
						method: "POST",
					})
				).status,
			).toBe(404);
		} finally {
			await host.close();
		}
	});

	test("the export surface is behind the token like every other route", async () => {
		const host = await startHost({
			projectRoot: await tempRoot(),
			registry: new TargetRegistry(await tempRoot()),
		});
		try {
			const denied = await fetch(
				`http://127.0.0.1:${host.port}/not-the-token/api/export`,
			);
			expect(denied.status).toBe(401);
		} finally {
			await host.close();
		}
	});
});

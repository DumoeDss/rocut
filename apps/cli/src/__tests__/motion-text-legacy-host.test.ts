import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { TargetRegistry } from "../target-registry";

const roots: string[] = [];
afterAll(async () => {
	for (const root of roots) {
		if (
			path.dirname(path.resolve(root)) !== path.resolve(tmpdir()) ||
			!path.basename(root).startsWith("rocut-legacy-cli-")
		)
			throw new Error("Unsafe fixture cleanup path");
		await rm(root, { recursive: true, force: true });
	}
});

for (const format of ["json", "html"] as const) {
	test(
		"legacy " +
			format +
			" catalog refusal gives an upgrade action and recovers without writes",
		async () => {
			const targetsRoot = await mkdtemp(
				path.join(tmpdir(), "rocut-legacy-cli-"),
			);
			roots.push(targetsRoot);
			const token = "test-only-legacy-token",
				id = "test-legacy-host";
			let legacy = true,
				writes = 0;
			const server = Bun.serve({
				hostname: "127.0.0.1",
				port: 0,
				fetch(req) {
					const pathname = new URL(req.url).pathname;
					if (req.method !== "GET") {
						writes++;
						return Response.json(
							{ error: "test refuses writes" },
							{ status: 405 },
						);
					}
					if (
						pathname === "/health" &&
						req.headers.get("authorization") === "Bearer " + token
					)
						return Response.json({ id });
					if (pathname !== "/" + token + "/api/motion-text/catalog")
						return Response.json({ error: "Not found" }, { status: 404 });
					if (!legacy)
						return Response.json({
							schemaVersion: 1,
							rendererSupportVersion: 1,
							presets: [],
						});
					return format === "json"
						? Response.json({ error: "Not found" }, { status: 404 })
						: new Response("<html>old host route missing</html>", {
								status: 404,
								headers: { "content-type": "text/html" },
							});
				},
			});
			await new TargetRegistry(targetsRoot).register({
				entry: {
					id,
					port: server.port!,
					pid: process.pid,
					projectPath: targetsRoot,
					startedAt: Date.now(),
				},
				secret: { id, port: server.port!, token },
			});
			const invoke = async () => {
				const child = Bun.spawn({
					cmd: [
						process.env.ROCUT_TEST_CLI_RUNTIME ?? process.execPath,
						process.env.ROCUT_TEST_CLI_ENTRY ??
							path.resolve(import.meta.dir, "../main.ts"),
						"motion-text",
						"catalog",
						"--targets-root",
						targetsRoot,
					],
					stdout: "pipe",
					stderr: "pipe",
				});
				const [code, stdout, stderr] = await Promise.all([
					child.exited,
					new Response(child.stdout).text(),
					new Response(child.stderr).text(),
				]);
				return { code, stdout, stderr };
			};
			try {
				const failed = await invoke();
				expect(failed.code).toBe(1);
				expect(failed.stdout).toBe("");
				expect(failed.stderr).toContain("Upgrade the Rocut plugin");
				expect(failed.stderr).toContain("reopen its editor");
				expect(failed.stderr).not.toContain(token);
				expect(failed.stderr).not.toContain("<html>");
				const detail = JSON.parse(failed.stderr.trim().split(/\r?\n/u)[1]!);
				expect(detail).toMatchObject({
					httpStatus: 404,
					route: "motion-text/catalog",
					response: {
						code: "motion-text-capability-unavailable",
						action: "upgrade-rocut-and-reopen",
					},
				});
				legacy = false;
				const recovered = await invoke();
				expect(recovered.code).toBe(0);
				expect(recovered.stderr).toBe("");
				expect(JSON.parse(recovered.stdout)).toMatchObject({
					target: id,
					catalog: { rendererSupportVersion: 1 },
				});
				expect(writes).toBe(0);
			} finally {
				server.stop(true);
			}
		},
		30000,
	);
}

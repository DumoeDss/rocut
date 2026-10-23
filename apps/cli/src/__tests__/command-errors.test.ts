import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TargetRegistry } from "../target-registry";

const entry = fileURLToPath(new URL("../main.ts", import.meta.url));
async function cli(args: string[]) {
	const child = Bun.spawn([process.execPath, entry, ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [code, output, error] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	return { code, output, error };
}

test("merged subcommands fail with a nonzero process result instead of successful usage", async () => {
	const { code, output, error } = await cli(["editing catalog"]);
	expect(code).not.toBe(0);
	expect(error).toContain("separate arguments");
	expect(output).not.toContain("rocut host");
});

test.each([false, true])(
	"draft stage preserves diagnostics and reports accepted=%s through its exit code",
	async (accepted) => {
		const root = await mkdtemp(path.join(tmpdir(), "rocut-command-errors-"));
		const response = { accepted, diagnostics: [{ code: "field-diagnostic" }] };
		const server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch(request) {
				const url = new URL(request.url);
				if (
					url.pathname === "/health" &&
					request.headers.get("authorization") === "Bearer isolated"
				)
					return Response.json({ id: "test" });
				if (
					url.pathname === "/isolated/api/drafts/example/stage" &&
					request.method === "POST"
				)
					return Response.json(response);
				return new Response("unavailable", { status: 404 });
			},
		});
		try {
			const targets = path.join(root, "targets");
			const registry = new TargetRegistry(targets);
			await registry.register({
				entry: {
					id: "test",
					port: server.port!,
					pid: process.pid,
					projectPath: root,
					startedAt: Date.now(),
				},
				secret: { id: "test", port: server.port!, token: "isolated" },
			});
			const operations = path.join(root, "operations.json");
			await writeFile(operations, JSON.stringify({ operations: [] }), "utf8");
			const result = await cli([
				"draft",
				"stage",
				operations,
				"--draft",
				"example",
				"--target",
				"test",
				"--targets-root",
				targets,
			]);
			expect(result.code).toBe(accepted ? 0 : 1);
			expect(JSON.parse(result.output)).toEqual(response);
			if (!accepted) expect(result.error).toContain("draft stage rejected");
		} finally {
			server.stop(true);
			if (
				path.dirname(root) === path.resolve(tmpdir()) &&
				path.basename(root).startsWith("rocut-command-errors-")
			)
				await rm(root, { recursive: true, force: true });
		}
	},
);

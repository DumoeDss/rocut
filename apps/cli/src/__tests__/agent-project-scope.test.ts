import { expect, test } from "bun:test";
import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { agentProjectScope, AgentProjectScope } from "../agent-project-scope";
import { TargetRegistry } from "../target-registry";
import { runCli } from "../main";

test("scoped CLI rejects foreign reads, writes, ensure and reap before any target HTTP while preserving the global registry", async () => {
	const root = await mkdtemp(path.join(tmpdir(), "rocut-agent-scope-"));
	const a = path.join(root, "project-a"),
		b = path.join(root, "project-b");
	const nativeA = path.join(a, "rocut", "mv"),
		nativeB = path.join(b, "rocut", "mv");
	await mkdir(nativeA, { recursive: true });
	await mkdir(nativeB, { recursive: true });
	const registryRoot = path.join(root, "registry");
	const calls: string[] = [];
	let revision = 1;
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch(request) {
			const url = new URL(request.url);
			calls.push(url.pathname);
			if (url.pathname === "/health")
				return Response.json({
					id:
						request.headers.get("authorization") === "Bearer a" ? "mv" : "mv-b",
				});
			if (url.pathname.endsWith("/apply")) {
				revision++;
				return Response.json({ accepted: true, revision });
			}
			if (url.pathname.endsWith("/context"))
				return Response.json({ revision, project: { id: "mv" } });
			return Response.json([]);
		},
	});
	const registry = new TargetRegistry(registryRoot);
	for (const [id, projectPath, token] of [
		["mv", nativeA, "a"],
		["mv-b", nativeB, "b"],
	])
		await registry.register({
			entry: {
				id,
				projectPath,
				pid: process.pid,
				port: server.port!,
				startedAt: Date.now(),
			},
			secret: { id, port: server.port!, token },
		});
	await registry.register({
		entry: {
			id: "foreign-dead",
			projectPath: nativeA,
			pid: 2147483647,
			port: server.port!,
			startedAt: 1,
		},
		secret: { id: "foreign-dead", port: server.port!, token: "unused" },
	});
	const indexBefore = await readFile(
		path.join(registryRoot, "targets.json"),
		"utf8",
	);
	const previous = process.env.ELFTIA_AGENT_PROJECT_ROOT;
	const stdout = process.stdout.write;
	let output = "";
	process.stdout.write = ((chunk: string | Uint8Array) => {
		output += Buffer.from(chunk).toString();
		return true;
	}) as typeof stdout;
	try {
		process.env.ELFTIA_AGENT_PROJECT_ROOT = b;
		const flags = ["--targets-root", registryRoot];
		for (const args of [
			["read", "--target", "mv"],
			["apply", "missing.json", "--target", "mv"],
			["read", "--project", nativeA],
			["host", "ensure", nativeA],
			["host", "start", nativeA],
			["target", "reap", "--project", nativeA],
		]) {
			await expect(runCli([...args, ...flags])).rejects.toThrow(
				"recover_production({restoreEnvironment:true})",
			);
			expect(calls).toHaveLength(0);
		}
		await runCli(["target", "list", ...flags]);
		expect(output).toContain("mv-b");
		expect(output).not.toContain(nativeA);
		const scoped = new TargetRegistry(registryRoot, new AgentProjectScope(b));
		expect((await scoped.resolve("auto"))?.entry.id).toBe("mv-b");
		expect(calls).toEqual(["/health"]);
		calls.length = 0;
		await runCli(["read", "--target", "mv-b", ...flags]);
		expect(output).toContain('"target": "mv-b"');
		expect(calls.some((route) => route.startsWith("/a/"))).toBe(false);
		calls.length = 0;
		await runCli(["host", "ensure", nativeB, ...flags]);
		expect(calls).toEqual(["/health"]);
		calls.length = 0;
		await runCli(["target", "reap", ...flags]);
		expect(calls).toEqual(["/health"]);
		calls.length = 0;
		await expect(scoped.remove("mv")).rejects.toThrow("active Agent project");
		expect(
			await readFile(path.join(registryRoot, "targets.json"), "utf8"),
		).toBe(indexBefore);
		const operations = path.join(root, "ops.json");
		await writeFile(operations, JSON.stringify({ operations: [] }));
		await expect(
			runCli(["apply", operations, "--dry-run", "--target", "mv-b", ...flags]),
		).rejects.toThrow("no request was sent");
		expect(calls).toHaveLength(0);
		expect(revision).toBe(1);
		await runCli(["apply", operations, "--target", "mv-b", ...flags]);
		expect(calls).toContain("/b/api/apply");
		expect(revision).toBe(2);
		calls.length = 0;
		delete process.env.ELFTIA_AGENT_PROJECT_ROOT;
		await expect(
			runCli(["apply", operations, "--dry-run", "--target", "mv", ...flags]),
		).rejects.toThrow("no request was sent");
		expect(calls).toHaveLength(0);
		expect(revision).toBe(2);
		await runCli(["read", "--target", "mv", ...flags]);
		expect(calls).toContain("/a/api/context");
		expect((await registry.list()).length).toBe(3);
	} finally {
		process.stdout.write = stdout;
		if (previous === undefined) delete process.env.ELFTIA_AGENT_PROJECT_ROOT;
		else process.env.ELFTIA_AGENT_PROJECT_ROOT = previous;
		server.stop(true);
		await rm(root, { recursive: true, force: true });
	}
});

test("scope rejects empty, relative, missing and redirected roots/targets; permits new nested host paths without creating them", async () => {
	const root = await mkdtemp(path.join(tmpdir(), "rocut-scope-path-"));
	try {
		expect(agentProjectScope({})).toBeUndefined();
		for (const value of ["", " ", ".", path.join(root, "absent")])
			expect(() =>
				agentProjectScope({ ELFTIA_AGENT_PROJECT_ROOT: value }),
			).toThrow();
		const scope = new AgentProjectScope(root);
		scope.assertProject(path.join(root, "new", "nested"), true);
		expect(scope.allows(path.join(root, "new"))).toBe(false);
		await expect(readFile(path.join(root, "new"))).rejects.toThrow();
		const actual = path.join(root, "actual");
		await mkdir(actual);
		const redirect = path.join(root, "redirect");
		await symlink(actual, redirect, "junction");
		expect(() => scope.assertProject(redirect)).toThrow();
		expect(() =>
			scope.assertProject(path.join(redirect, "new"), true),
		).toThrow();
		if (process.platform === "win32")
			new AgentProjectScope(root.toUpperCase()).assertProject(
				actual.toUpperCase(),
			);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { TargetRegistry } from "../target-registry";

const cli = path.resolve(import.meta.dir, "../main.ts");
async function removeFixture(root: string): Promise<void> {
	const resolved = path.resolve(root);
	if (
		path.dirname(resolved) !== path.resolve(tmpdir()) ||
		!/^rocut-(concurrent|writers|lock)-/.test(path.basename(resolved))
	)
		throw Error("Fixture cleanup escaped its temp directory");
	await rm(resolved, { recursive: true, force: true });
}
function run(args: string[], scope?: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, args, {
			env: {
				...process.env,
				...(scope ? { ELFTIA_AGENT_PROJECT_ROOT: scope } : {}),
			},
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		});
		let output = "",
			error = "";
		child.stdout.on("data", (chunk) => {
			output += chunk;
		});
		child.stderr.on("data", (chunk) => {
			error += chunk;
		});
		child.once("error", reject);
		child.once("exit", (code) =>
			code === 0
				? resolve(output)
				: reject(new Error(`fixture exit ${code}: ${error}`)),
		);
	});
}

test("two independent scoped CLI ensures for same-basename projects both route correctly", async () => {
	const root = await mkdtemp(path.join(tmpdir(), "rocut-concurrent-"));
	const a = path.join(root, "a"),
		b = path.join(root, "b");
	const nativeA = path.join(a, "rocut", "mv"),
		nativeB = path.join(b, "rocut", "mv");
	const registry = new TargetRegistry(path.join(root, "registry"));
	await Promise.all([
		mkdir(nativeA, { recursive: true }),
		mkdir(nativeB, { recursive: true }),
	]);
	try {
		const flags = ["--targets-root", registry.root, "--timeout", "10000"];
		const coldStarted = performance.now();
		const outputs = await Promise.all([
			run([cli, "host", "ensure", nativeA, ...flags], a),
			run([cli, "host", "ensure", nativeB, ...flags], b),
			run([cli, "host", "ensure", nativeA, ...flags], a),
		]);
		console.info(
			`Concurrent scoped cold ensure (two projects, three CLI callers): ${Math.round(performance.now() - coldStarted)}ms`,
		);
		expect(outputs[0].match(/^pid (\d+)$/m)?.[1]).toBe(
			outputs[2].match(/^pid (\d+)$/m)?.[1],
		);
		const entries = await registry.list();
		expect(entries).toHaveLength(2);
		expect(new Set(entries.map((entry) => entry.id)).size).toBe(2);
		for (const [scope, native, output] of [
			[a, nativeA, outputs[0]],
			[b, nativeB, outputs[1]],
		]) {
			const entry = entries.find((entry) => entry.projectPath === native)!;
			expect(output).toContain(`target ${entry.id}`);
			const secretBefore = await readFile(
				path.join(registry.root, "targets", `${entry.id}.json`),
				"utf8",
			);
			const read = await run(
				[cli, "read", "--target", entry.id, "--targets-root", registry.root],
				scope,
			);
			expect(JSON.parse(read).target).toBe(entry.id);
			const reused = await Promise.all(
				[1, 2].map(() => run([cli, "host", "ensure", native, ...flags], scope)),
			);
			expect(reused.every((text) => text.includes("state reused"))).toBe(true);
			expect(
				await readFile(
					path.join(registry.root, "targets", `${entry.id}.json`),
					"utf8",
				),
			).toBe(secretBefore);
		}
		expect(await registry.list()).toHaveLength(2);
	} finally {
		for (const entry of await registry.list()) {
			if (entry.projectPath === nativeA || entry.projectPath === nativeB) {
				try {
					process.kill(entry.pid);
				} catch {}
			}
		}
		// Fixture daemon shutdown can briefly retain its project cwd on Windows.
		for (let attempt = 0; ; attempt++) {
			try {
				await removeFixture(root);
				break;
			} catch (error) {
				if (attempt >= 30) throw error;
				await Bun.sleep(100);
			}
		}
	}
}, 60000);

test("independent registry writers preserve register, remove and activity updates", async () => {
	const root = await mkdtemp(path.join(tmpdir(), "rocut-writers-"));
	const registry = new TargetRegistry(root);
	const make = (id: string) => ({
		entry: {
			id,
			port: 1,
			pid: process.pid,
			projectPath: path.join(root, id),
			startedAt: Date.now(),
		},
		secret: { id, port: 1, token: `fixture-${id}` },
	});
	try {
		await registry.register(make("keep"));
		await registry.register(make("remove"));
		await registry.register({
			...make("reap"),
			entry: { ...make("reap").entry, startedAt: 1, pid: 2147483647 },
		});
		const module = path
			.resolve(import.meta.dir, "../target-registry.ts")
			.replaceAll("\\", "/");
		const scripts = [
			`await r.register(${JSON.stringify(make("new-a"))});`,
			`await r.register(${JSON.stringify(make("new-b"))});`,
			'await r.remove("remove");',
			'await r.patchEntry("keep", {lastActivityAt:123456});',
		];
		await Promise.all([
			...scripts.map((script) =>
				run([
					"-e",
					`import {TargetRegistry} from ${JSON.stringify(module)}; const r=new TargetRegistry(${JSON.stringify(root)}); ${script}`,
				]),
			),
			run([
				cli,
				"target",
				"reap",
				"--project",
				path.join(root, "reap"),
				"--targets-root",
				root,
			]),
		]);
		expect((await registry.list()).map((entry) => entry.id).sort()).toEqual([
			"keep",
			"new-a",
			"new-b",
		]);
		expect(
			(await registry.list()).find((entry) => entry.id === "keep")
				?.lastActivityAt,
		).toBe(123456);
		const secret = await registry.readSecret("keep");
		await expect(
			registry.register({
				...make("keep"),
				entry: {
					...make("keep").entry,
					projectPath: path.join(root, "foreign"),
				},
			}),
		).rejects.toThrow("occupied");
		expect(await registry.readSecret("keep")).toEqual(secret);
		const old = (await registry.list()).find((entry) => entry.id === "keep")!;
		await registry.register({
			...make("keep"),
			entry: { ...old, port: 2, startedAt: old.startedAt + 1 },
		});
		await registry.remove("keep", old); // A reap classified the previous incarnation.
		expect(
			(await registry.list()).find((entry) => entry.id === "keep")?.port,
		).toBe(2);
	} finally {
		await removeFixture(root);
	}
});

test("an existing lock times out or cancels without stealing it or changing metadata", async () => {
	const root = await mkdtemp(path.join(tmpdir(), "rocut-lock-"));
	try {
		const registry = new TargetRegistry(root);
		const expired = await registry.withExclusive(async (leased) => leased);
		await mkdir(path.join(root, "targets.write-lock"));
		await expect(
			registry.withExclusive(
				async () => {
					throw Error("must not run");
				},
				{ timeoutMs: 30 },
			),
		).rejects.toThrow("timed out");
		await expect(
			expired.withExclusive(
				async () => {
					throw Error("expired lease escaped lock");
				},
				{ timeoutMs: 30 },
			),
		).rejects.toThrow("timed out");
		const controller = new AbortController();
		setTimeout(() => controller.abort(), 10);
		await expect(
			registry.withExclusive(
				async () => {
					throw Error("must not run");
				},
				{ signal: controller.signal },
			),
		).rejects.toThrow();
		expect(await registry.list()).toEqual([]);
		await expect(
			mkdir(path.join(root, "targets.write-lock")),
		).rejects.toThrow();
	} finally {
		await removeFixture(root);
	}
});

test("callback failure releases its lock; replaced lock identity is preserved", async () => {
	const root = await mkdtemp(path.join(tmpdir(), "rocut-lock-"));
	try {
		const registry = new TargetRegistry(root);
		await expect(
			registry.withExclusive(async () => {
				throw Error("fixture failure");
			}),
		).rejects.toThrow("fixture failure");
		expect(await registry.withExclusive(async () => "released")).toBe(
			"released",
		);
		const lock = path.join(root, "targets.write-lock");
		await expect(
			registry.withExclusive(async () => {
				await rename(lock, path.join(root, "original-owned-lock"));
				await mkdir(lock);
			}),
		).rejects.toThrow("identity changed");
		await expect(mkdir(lock)).rejects.toThrow();
	} finally {
		await removeFixture(root);
	}
});

import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

if (process.env.OPENCUT_HEADLESS_MIGRATION_ISOLATED !== "1") {
	test("shared full/headless migration suite runs in an isolated process", () => {
		const result = Bun.spawnSync({
			cmd: [process.execPath, "test", fileURLToPath(import.meta.url)],
			cwd: process.cwd(),
			env: {
				...process.env,
				OPENCUT_HEADLESS_MIGRATION_ISOLATED: "1",
			},
			stderr: "pipe",
			stdout: "pipe",
		});
		if (result.exitCode !== 0) {
			throw new Error(
				`isolated shared migration suite failed:\n${result.stdout.toString()}\n${result.stderr.toString()}`,
			);
		}
	});
} else {
	await import("./wasm-test-mock");
	const { createInMemoryHost } = await import("@/editor/ports/in-memory/host");
	const { InMemoryProjectStore } = await import("@/editor/ports/in-memory");
	const { createEditorSession, MigrationFailedError } =
		await import("../create-session");
	const { createHeadlessEditorSession } = await import("../headless");

	type Owner = { dispose(): Promise<unknown> };
	type Factory = (
		store: InstanceType<typeof InMemoryProjectStore>,
	) => Promise<Owner>;

	const full: Factory = (store) =>
		createEditorSession({ host: createInMemoryHost({ store }) });
	const headless: Factory = (store) =>
		createHeadlessEditorSession({ host: createInMemoryHost({ store }) });

	describe("one migration gate is shared by full and headless factories", () => {
		for (const [label, leftFactory, rightFactory] of [
			["full/full", full, full],
			["full/headless", full, headless],
			["headless/full", headless, full],
			["headless/headless", headless, headless],
		] as const) {
			test(`${label} callers join one delayed store run`, async () => {
				let migrationCalls = 0;
				let release!: () => void;
				const gate = new Promise<void>((resolve) => {
					release = resolve;
				});
				const store = new InMemoryProjectStore({
					schemaVersion: 2,
					migrate: async (context) => {
						migrationCalls += 1;
						await gate;
						return {
							status: "migrated" as const,
							from: context.from,
							to: context.to,
							recordsMigrated: 0,
						};
					},
				});
				let settled = 0;
				const left = leftFactory(store).then((owner) => {
					settled += 1;
					return owner;
				});
				const right = rightFactory(store).then((owner) => {
					settled += 1;
					return owner;
				});
				await Promise.resolve();
				expect(migrationCalls).toBe(1);
				expect(settled).toBe(0);
				release();
				const owners = await Promise.all([left, right]);
				expect(settled).toBe(2);
				await Promise.all(owners.map((owner) => owner.dispose()));
			});
		}

		test("distinct stores migrate independently", async () => {
			let calls = 0;
			const createStore = () =>
				new InMemoryProjectStore({
					schemaVersion: 2,
					migrate: async (context) => {
						calls += 1;
						return {
							status: "migrated" as const,
							from: context.from,
							to: context.to,
							recordsMigrated: 0,
						};
					},
				});
			const owners = await Promise.all([
				headless(createStore()),
				headless(createStore()),
			]);
			expect(calls).toBe(2);
			await Promise.all(owners.map((owner) => owner.dispose()));
		});

		test("a failed headless creation preserves error identity and retries", async () => {
			let attempts = 0;
			const store = new InMemoryProjectStore({
				schemaVersion: 3,
				migrate: async (context) => {
					attempts += 1;
					if (attempts === 1) {
						return {
							status: "failed" as const,
							from: context.from,
							to: context.to,
							reason: "transient headless failure",
						};
					}
					return {
						status: "not-needed" as const,
					};
				},
			});
			const first = headless(store);
			await expect(first).rejects.toBeInstanceOf(MigrationFailedError);
			await expect(first).rejects.toThrow("transient headless failure");
			const retry = await full(store);
			expect(attempts).toBe(2);
			await retry.dispose();
		});
	});
}

import { expect, mock, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { createProjectReadiness } from "./project-readiness";

if (process.env.ROCUT_TASK_READINESS_ISOLATED !== "1") {
	test("host task readiness uses isolated provider doubles", () => {
		const child = Bun.spawnSync({
			cmd: [process.execPath, "test", fileURLToPath(import.meta.url)],
			env: { ...process.env, ROCUT_TASK_READINESS_ISOLATED: "1" },
			stdout: "pipe",
			stderr: "pipe",
		});
		if (child.exitCode !== 0)
			throw Error(child.stdout.toString() + child.stderr.toString());
	}, 15_000);
} else {
	let runs = 0;
	mock.module("@opencut/editor-classic/agent-tasks", () => ({
		createEditorTaskRunner: () => ({
			run: async () => {
				runs++;
				return { revision: 2 };
			},
		}),
	}));
	const { createHostEditorTasks } = await import("./editor-tasks");
	for (const action of ["editor-task.cancel", "disconnect"] as const)
		test(`${action} while hydrating never starts provider run`, async () => {
			let finish!: () => void;
			const hydration = new Promise<void>((resolve) => {
				finish = resolve;
			});
			const ready = createProjectReadiness({
				reload: () => hydration,
				schedule: () => () => {},
			});
			ready.changed();
			const reports: Array<{ error?: string }> = [];
			const originalFetch = globalThis.fetch;
			const originalLocation = Object.getOwnPropertyDescriptor(
				globalThis,
				"location",
			);
			Object.defineProperty(globalThis, "location", {
				configurable: true,
				value: { href: "http://localhost/project/" },
			});
			globalThis.fetch = (async (_url, init) => {
				reports.push(JSON.parse(String(init?.body)));
				return new Response("{}", { status: 200 });
			}) as typeof fetch;
			try {
				const before = runs;
				const tasks = createHostEditorTasks(
					{ editor: {} as never },
					ready.whenReady,
				);
				tasks.handle({
					command: "editor-task.start",
					jobId: "owned",
					token: "test-only",
					request: {
						kind: "history.status",
						expectedRevision: 2,
						idempotencyKey: "status",
					},
				});
				await Promise.resolve();
				await Promise.resolve();
				if (action === "disconnect") tasks.disconnect();
				else tasks.handle({ command: action, jobId: "owned" });
				// Drain promise callbacks without wall-clock sleeps or completing reload.
				for (let step = 0; step < 12; step++) await Promise.resolve();
				expect(runs).toBe(before);
				expect(reports).toHaveLength(1);
				expect(reports[0].error).toBeTruthy();
				finish();
				await ready.whenReady();
				expect(runs).toBe(before);
			} finally {
				finish();
				globalThis.fetch = originalFetch;
				if (originalLocation)
					Object.defineProperty(globalThis, "location", originalLocation);
				else Reflect.deleteProperty(globalThis, "location");
			}
		});
}

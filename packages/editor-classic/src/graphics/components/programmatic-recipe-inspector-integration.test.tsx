import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

// React DOM caches browser capability at module initialization. SSR tests in
// the parent process can initialize it before JSDOM exists. Keep DOM setup and
// all React/product imports in a fresh child, never in this discovery wrapper.
if (process.env.ROCUT_RECIPE_DOM_TEST_CHILD === "1") {
	await import("./programmatic-recipe-inspector-integration.cases");
} else {
	test("isolated mounted recipe Inspector integration", () => {
		const child = spawnSync(process.execPath, ["test", import.meta.path], {
			env: { ...process.env, ROCUT_RECIPE_DOM_TEST_CHILD: "1" },
			encoding: "utf8",
			timeout: 30_000,
		});
		if (child.stdout) process.stdout.write(child.stdout);
		if (child.stderr) process.stderr.write(child.stderr);
		if (child.error) throw child.error;
		expect(child.signal).toBeNull();
		expect(child.status).toBe(0);
	}, 35_000);
}

import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

if (process.env.ROCUT_HF_ELECTRON_GRAPH_CHILD === "1") {
	await import("./hyperframes-electron-graph-lifetime.cases");
} else {
	test("isolated Electron HyperFrames graph routing and lifetime", () => {
		const result = spawnSync(process.execPath, ["test", import.meta.path], {
			env: { ...process.env, ROCUT_HF_ELECTRON_GRAPH_CHILD: "1" },
			encoding: "utf8",
			timeout: 30_000,
		});
		if (result.stdout) process.stdout.write(result.stdout);
		if (result.stderr) process.stderr.write(result.stderr);
		if (result.error) throw result.error;
		expect(result.status).toBe(0);
	}, 35_000);
}

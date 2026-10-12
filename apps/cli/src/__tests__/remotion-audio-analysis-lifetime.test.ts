import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

if (process.env.ROCUT_REMOTION_LIFETIME_CHILD === "1") {
	await import("./remotion-audio-analysis-lifetime.cases");
} else {
	test("isolated Remotion audio analyzer lifetime", () => {
		const result = spawnSync(process.execPath, ["test", import.meta.path], {
			env: { ...process.env, ROCUT_REMOTION_LIFETIME_CHILD: "1" },
			encoding: "utf8",
			timeout: 30000,
			windowsHide: true,
		});
		if (result.status !== 0) console.error(result.stdout + result.stderr);
		expect(result.status).toBe(0);
	});
}

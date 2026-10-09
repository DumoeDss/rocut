import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHost } from "../host";
import { TargetRegistry } from "../target-registry";

test("Host advertises standalone inspection as configured-not-health-probed and rejects unavailable/Electron routes honestly", async () => {
	const root = await mkdtemp(join(tmpdir(), "rocut-inspection-capability-"));
	try {
		for (const mode of ["standalone", "electron", "unconfigured"] as const) {
			const host = await startHost({
				projectRoot: join(root, mode),
				registry: new TargetRegistry(join(root, `${mode}-registry`)),
				engineToolchainDirectory:
					mode === "unconfigured"
						? ""
						: join(root, "not-health-probed-toolchain"),
				htmlBrowserExecutable: join(root, "not-health-probed-browser.exe"),
				htmlFrameConnectionFile:
					mode === "electron" ? join(root, "electron-connection.json") : "",
			});
			try {
				const context = await (
					await fetch(new URL("api/context", host.editorUrl))
				).json();
				expect(context.programmaticBuilds.remotionInspection).toMatchObject({
					configured: mode === "standalone",
					inspect: "programmatic/build/inspect",
					compile: "programmatic/build/compile-inspected",
				});
				if (mode === "standalone")
					expect(context.programmaticBuilds.availability).toBe(
						"configured-not-health-probed",
					);
				else
					for (const action of ["inspect", "compile-inspected"]) {
						const response = await fetch(
							new URL(`api/programmatic/build/${action}`, host.editorUrl),
							{ method: "POST", body: "{}" },
						);
						expect(response.status).toBe(503);
						expect(await response.text()).toContain(
							"requires standalone browser and pinned toolchain",
						);
					}
				expect(
					(
						await fetch(
							new URL("/wrong/api/programmatic/build/inspect", host.editorUrl),
							{ method: "POST", body: "{}" },
						)
					).status,
				).toBe(401);
			} finally {
				await host.close();
			}
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHost } from "../host";
import { TargetRegistry } from "../target-registry";
import { REMOTION_TOOLCHAIN } from "../programmatic/engines/engine-versions";

test("Host advertises standalone inspection as configured-not-health-probed and rejects unavailable or ungranted Electron routes", async () => {
	const root = await mkdtemp(join(tmpdir(), "rocut-inspection-capability-"));
	try {
		// Dependency readiness is now checked separately from browser/compiler
		// health. These metadata-only fixtures do not claim executable health.
		const toolchain = join(root, "not-health-probed-toolchain");
		const packages: Record<string, object> = {};
		for (const [name, version] of Object.entries(REMOTION_TOOLCHAIN)) {
			const directory = join(toolchain, "node_modules", name);
			await mkdir(directory, { recursive: true });
			await writeFile(join(directory, "package.json"), JSON.stringify({ name, version }));
			packages[`node_modules/${name}`] = { version, integrity: "sha512-YQ==" };
		}
		await mkdir(join(toolchain, "node_modules/esbuild/lib"));
		await writeFile(join(toolchain, "node_modules/esbuild/lib/main.js"), "// metadata-only fixture");
		await writeFile(join(toolchain, "package-lock.json"), JSON.stringify({ packages }));
		for (const mode of ["standalone", "electron", "unconfigured"] as const) {
			const host = await startHost({
				projectRoot: join(root, mode),
				registry: new TargetRegistry(join(root, `${mode}-registry`)),
				engineToolchainDirectory:
					mode === "unconfigured"
						? ""
						: toolchain,
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
							"pinned toolchain",
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

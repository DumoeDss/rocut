import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

if (process.env.OPENCUT_HEADLESS_BROWSER_BOUNDARY_ISOLATED !== "1") {
	test("headless browser-global boundary runs in an isolated process", () => {
		const result = Bun.spawnSync({
			cmd: [process.execPath, "test", fileURLToPath(import.meta.url)],
			cwd: process.cwd(),
			env: {
				...process.env,
				OPENCUT_HEADLESS_BROWSER_BOUNDARY_ISOLATED: "1",
			},
			stderr: "pipe",
			stdout: "pipe",
		});
		if (result.exitCode !== 0) {
			throw new Error(
				`isolated headless browser boundary failed:\n${result.stdout.toString()}\n${result.stderr.toString()}`,
			);
		}
	});
} else {
	test("isolated import and round trip never read browser mechanisms", async () => {
		const indexedDbName = ["indexed", "DB"].join("");
		const names = ["window", "document", indexedDbName, "navigator"] as const;
		const originals = new Map<string, PropertyDescriptor | undefined>();
		const touched: string[] = [];
		for (const name of names) {
			originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
		}
		for (const name of ["window", "document", indexedDbName] as const) {
			Object.defineProperty(globalThis, name, {
				configurable: true,
				get: () => {
					touched.push(name);
					throw new Error(`Forbidden browser global read: ${name}`);
				},
			});
		}
		const originalNavigator = globalThis.navigator;
		Object.defineProperty(globalThis, "navigator", {
			configurable: true,
			value: new Proxy(originalNavigator, {
				get: (target, property, receiver) => {
					if (property === "storage") {
						touched.push(["navigator", "storage/OPFS"].join("."));
						throw new Error("Forbidden OPFS access");
					}
					return Reflect.get(target, property, receiver);
				},
			}),
		});

		try {
			const { installHeadlessRuntimeProbe } =
				await import("../headless-runtime-probe");
			const runtimeProbe = installHeadlessRuntimeProbe({
				host: "node",
				environment: "node",
				buildMarker: "c7-browser-sentinel-test",
				entry: "headless-browser-boundary.test.ts",
			});
			runtimeProbe.markSubjectLoadStarted();
			const { runHeadlessSemanticFixture } =
				await import("../headless-semantic-fixture");
			const result = await runHeadlessSemanticFixture({
				host: "node",
				buildMarker: "c7-browser-sentinel-test",
				acceptedHead: "test-head",
				acceptedTree: "test-tree",
				entry: "headless-browser-boundary.test.ts",
				runtimeProbe,
			});
			expect(result.reopenedName).toBe("C7 headless edit");
			expect(result.errors).toEqual([]);
			expect(touched).toEqual([]);
		} finally {
			for (const name of names) {
				const descriptor = originals.get(name);
				if (descriptor) {
					Object.defineProperty(globalThis, name, descriptor);
				} else {
					Reflect.deleteProperty(globalThis, name);
				}
			}
		}
	});
}

/**
 * s05-second-host — port conformance for `FilesystemProjectStore` (task 4.3).
 *
 * The published `runPortConformance` suite runs on the portable profile with
 * migration exercised, over ports composed the way this Host composes them
 * (in-memory reference roles, filesystem store substituted) and a
 * disposable-root `NodeFsStoreBridge` fixture — no Electron involved, which is
 * the point: the same store class the renderer uses carries the evidence.
 *
 * `FilesystemProjectStore` consumes the published migration artifacts from
 * `@opencut/editor-classic/storage`, whose module graph statically reaches the
 * real `opencut-wasm` package — under `bun test` that init throws. This file
 * follows the repo's established pattern (see
 * `apps/web/src/editor/host/__tests__/production-composition.test.ts` and the
 * header of `packages/editor-classic/src/evidence/index.ts`): the real suite
 * runs in an isolated child process whose first sequential import installs
 * `evidence/wasm-test-mock`, so the process-global `mock.module("opencut-wasm")`
 * never reaches any other test file. Run the inner suite directly with
 * `OPENCUT_FS_STORE_TEST_ISOLATED=1 bun test <this file>` to see per-case
 * output.
 *
 * The suite's opaque-payload case ("a known edit round-trips without losing
 * opaque nested fields") is the provider-private round-trip requirement; it is
 * asserted by name below and recorded in the evidence log.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, expect, test } from "bun:test";
import type { ConformanceReport } from "@opencut/editor-ports/conformance";

if (process.env.OPENCUT_FS_STORE_TEST_ISOLATED !== "1") {
	test("filesystem store conformance runs in an isolated wasm-mock process", () => {
		const result = Bun.spawnSync({
			cmd: [process.execPath, "test", fileURLToPath(import.meta.url)],
			cwd: process.cwd(),
			env: {
				...process.env,
				OPENCUT_FS_STORE_TEST_ISOLATED: "1",
			},
			stderr: "pipe",
			stdout: "pipe",
		});
		if (result.exitCode !== 0) {
			throw new Error(
				`isolated filesystem store conformance suite failed:\n${result.stdout.toString()}\n${result.stderr.toString()}`,
			);
		}
	});
} else {
	await import("@opencut/editor-classic/evidence/wasm-test-mock");
	const { runPortConformance } = await import(
		"@opencut/editor-ports/conformance"
	);
	const { createInMemoryPorts } = await import("@opencut/editor-ports/in-memory");
	const { NodeFsStoreBridge } = await import("../node-fs-store-bridge");
	const { FilesystemProjectStore, FilesystemProjectStoreControl } = await import(
		"../filesystem-project-store"
	);

	const identity = "opencut-fs-disposable-conformance";
	const prefix = "opencut-fs-disposable-";
	const root = mkdtempSync(join(tmpdir(), "opencut-fs-conformance-"));
	const control = new FilesystemProjectStoreControl();
	const store = new FilesystemProjectStore(
		new NodeFsStoreBridge({ root, identity }),
		{
			identity,
			migrationPolicy: { kind: "disposable", identity, prefix },
			control,
		},
	);

	let report: ConformanceReport;

	afterAll(() => {
		rmSync(root, { recursive: true, force: true });
	});

	test("filesystem store passes the published conformance suite (portable, migration exercised)", async () => {
		report = await runPortConformance({
			ports: createInMemoryPorts({ store }),
			label: "electron-host filesystem store over NodeFsStoreBridge",
			storeFixture: {
				store,
				control,
				disposableMigration: {
					identity,
					prefix,
					store,
					cleanup: {
						identity,
						store,
						run: async () => {
							rmSync(root, { recursive: true, force: true });
						},
					},
				},
			},
			exerciseMigration: true,
		});
		for (const result of report.results) {
			console.log(
				`  [${result.port}] ${result.status.toUpperCase()} — ${result.name}` +
					(result.status === "passed" ? "" : ` :: ${result.detail ?? ""}`),
			);
		}
		console.log("  by-port tally:", JSON.stringify(report.byPort));
		expect(report.passed).toBe(true);
	});

	test("the provider-private round-trip case (opaque nested fields) passed by name", () => {
		const opaqueCase = report.results.find((result) =>
			result.name.includes("opaque nested fields"),
		);
		console.log(
			"  opaque-payload case:",
			opaqueCase ? `${opaqueCase.status} — ${opaqueCase.name}` : "NOT FOUND",
		);
		expect(opaqueCase?.status).toBe("passed");
	});

	test("no port role reports zero cases", () => {
		for (const [role, tally] of Object.entries(report.byPort)) {
			const total = tally.passed + tally.failed + tally.skipped;
			console.log(`  ${role}: ${total} case(s)`);
			expect(total).toBeGreaterThan(0);
		}
	});
}

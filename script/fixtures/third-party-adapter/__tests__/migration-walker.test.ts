/**
 * Migration-walker validation against the REAL published chain (S05 P3, 5.2).
 *
 * The production runner records a finding — `@opencut/editor-classic/storage`
 * cannot initialize in a plain TS consumer because the chain is transitively
 * bound to the `opencut-wasm` artifact (transformer v27->v28 imports
 * `roundMediaTime`). This test does NOT change that finding: it loads
 * classic's own published test mock for the wasm artifact (declared entry
 * `./evidence/wasm-test-mock`, the same mechanism classic's own storage tests
 * use) so the walker's semantics AND the ports suite's migration case can be
 * validated against the real 31-step chain. Walker green here + loading
 * finding there is the honest pair.
 */
import { expect, test } from "bun:test";

await import("@opencut/editor-classic/evidence/wasm-test-mock");

import type { ProjectId } from "@opencut/editor-ports";
import { runPortConformance } from "@opencut/editor-ports/conformance";

import {
	demonstrateLegacyMigration,
	loadClassicMigrationChain,
	createLegacyMigrator,
} from "../src/migrate";
import { AlienProjectStore } from "../src/alien-store";
import { createAlienPorts } from "../src/roles";

const DISPOSABLE_PREFIX = "alien-legacy-disposable-";

test("the alien migration walker runs the real published chain", async () => {
	const chain = await loadClassicMigrationChain();
	expect(chain).not.toBeNull();
	if (!chain) return;
	expect(chain.target).toBeGreaterThan(1);
	const transcript = await demonstrateLegacyMigration(chain);
	console.log(transcript);
});

test("the ports suite passes with the migration case exercised", async () => {
	const chain = await loadClassicMigrationChain();
	expect(chain).not.toBeNull();
	if (!chain) return;
	const store = new AlienProjectStore({ schemaVersion: chain.target });
	store.migrate = createLegacyMigrator({ store, chain });
	const identity = `${DISPOSABLE_PREFIX}ports-suite`;
	await store.seedLegacy({
		id: identity as ProjectId,
		schemaVersion: chain.target - 1,
		data: { version: chain.target - 1, title: "Alien disposable" },
	});
	const report = await runPortConformance({
		ports: createAlienPorts({ store }),
		label: "alien adapter ports (migration exercised)",
		storeFixture: {
			store,
			control: store.fixtureControl,
			disposableMigration: {
				identity,
				prefix: DISPOSABLE_PREFIX,
				store,
				cleanup: {
					identity,
					store,
					run: () => store.remove({ id: identity as ProjectId }),
				},
			},
		},
		exerciseMigration: true,
	});
	expect(report.passed).toBe(true);
	const migrationCases = report.results.filter((result) =>
		/migrat/i.test(result.name),
	);
	console.log(
		`migration cases: ${migrationCases
			.map((result) => `${result.name}=${result.status}`)
			.join(", ")}`,
	);
});

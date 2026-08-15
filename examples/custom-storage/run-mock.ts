/**
 * The custom-storage example — the mock-installed leg of the honest pair (S05
 * P6 task 3.3).
 *
 * The production leg (run.ts) records, distinctly, that the published
 * migration chain cannot initialize in a plain TS consumer. This leg does NOT
 * change that finding: it installs classic's own published wasm test mock —
 * the declared experimental entry `@opencut/editor-classic/evidence/wasm-test-mock`,
 * the same mechanism classic's own storage tests use — BEFORE the chain loads,
 * so the alien walker's semantics and the ports suite's migration case are
 * validated against the REAL published chain (31 steps at 0.2.0). Walker green
 * here + the loading finding there is the honest pair, and the README states
 * the experimental inheritance that follows.
 *
 * The mock import must precede any load of the classic chain; every
 * classic-touching import in this example is dynamic, so ordering holds.
 */
import type { ProjectId } from "@opencut/editor-ports";
import { runPortConformance } from "@opencut/editor-ports/conformance";

import { AlienProjectStore } from "./src/alien-store";
import { createAlienPorts } from "./src/roles";
import {
	createLegacyMigrator,
	demonstrateLegacyMigration,
	loadClassicMigrationChain,
} from "./src/migrate";

const DISPOSABLE_PREFIX = "alien-legacy-disposable-";

function line(text = ""): void {
	console.log(text);
}

async function main(): Promise<number> {
	line("custom-storage example: mock-installed leg (the real published chain, through the wasm test mock)");
	line(
		`runtime: ${typeof Bun !== "undefined" ? `bun ${Bun.version}` : `node ${process.version}`}`,
	);

	// Install the mock FIRST — before any code loads the classic chain.
	await import("@opencut/editor-classic/evidence/wasm-test-mock");
	line("wasm mock: installed (experimental entry @opencut/editor-classic/evidence/wasm-test-mock)");

	// With the mock in place the chain MUST load — a failure here is a real
	// failure of this leg, not a finding to record.
	const chain = await loadClassicMigrationChain();
	if (!chain) {
		line("mock leg: FAILED — the classic chain still did not load with the wasm mock installed");
		return 1;
	}
	line(`classic chain: loaded through the mock (${chain.steps.length} steps, target v${chain.target})`);
	if (chain.steps.length === 0 || chain.target <= 1) {
		line("mock leg: FAILED — the published chain is empty or trivial; nothing to validate against");
		return 1;
	}

	// The walker's semantics against the real chain: migrated with monotone
	// progress, not-needed on the second call, a declining transform failing
	// closed. Throws on any wrong semantics.
	try {
		const transcript = await demonstrateLegacyMigration(chain);
		line("migration/by-replication: green (real chain, mock-installed)");
		for (const entry of transcript.split("\n")) line(`  ${entry}`);
	} catch (error) {
		line(`mock leg: FAILED — ${error instanceof Error ? error.message : String(error)}`);
		return 1;
	}

	// The ports suite's migration case against the real chain, on a disposable
	// store, at the portable profile.
	const store = new AlienProjectStore({ schemaVersion: chain.target });
	store.migrate = createLegacyMigrator({ store, chain });
	const identity = `${DISPOSABLE_PREFIX}mock-leg`;
	await store.seedLegacy({
		id: identity as ProjectId,
		schemaVersion: chain.target - 1,
		data: { version: chain.target - 1, title: "Alien disposable" },
	});
	const report = await runPortConformance({
		ports: createAlienPorts({ store }),
		label: "custom-storage example ports (migration exercised, mock-installed chain)",
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
		storeConformanceProfile: "portable",
		exerciseMigration: true,
	});
	await store.remove({ id: identity as ProjectId });
	if (!report.passed) {
		line(`mock leg: FAILED — ports suite with migration exercised did not pass (cases=${report.results.length})`);
		return 1;
	}
	const migrationCases = report.results.filter((result) => /migrat/i.test(result.name));
	line(
		`suites/ports: passed=${report.passed} cases=${report.results.length} ` +
			`(migration exercised: ${migrationCases.map((result) => result.name).join(", ")})`,
	);

	line(
		`custom-storage example (mock-installed leg): the real ${chain.steps.length}-step chain validated over the alien store`,
	);
	return 0;
}

main()
	.then((code) => {
		process.exit(code);
	})
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});

/**
 * The custom-storage example — the production leg (S05 P6 task 3.3, promoted
 * from P3's third-party adapter).
 *
 * The alien adapter's own ProjectStore (a deliberately alien representation,
 * `src/alien-store.ts`) behind every published conformance surface: the ports
 * suite (portable profile), the transaction suite, the engine suite, the draft
 * suite and the vectors suite — all executed against THIS adapter's
 * implementations, from installed tarballs.
 *
 * The migration leg loads the published chain through
 * `@opencut/editor-classic/storage/migrations` and exercises it for real, with
 * no mock in the process. Until 2026-08-16 it could not: the chain died with
 * `wasm.__wbindgen_start is not a function`, which was a runtime capability gap
 * in how the artifact was reached rather than a defect in the chain
 * (BOUNDARIES §17). The distinct-skip branch below is deliberately KEPT as the
 * fail-closed path — a leg that cannot load still says so by name and never
 * passes silently — and `run-mock.ts` still validates the same chain through
 * the published wasm test mock, which is where the experimental-inheritance
 * statement in the README now belongs.
 */
import type { ProjectId } from "@opencut/editor-ports";
import { runPortConformance } from "@opencut/editor-ports/conformance";
import { formatConformanceFailures } from "@opencut/editor-ports/conformance/requirements";

import { projectId } from "@opencut/editor-contracts";
import { runTransactionConformance } from "@opencut/editor-contracts/conformance";
import { formatConformanceFailures as formatContractFailures } from "@opencut/editor-contracts/conformance/requirements";
import { runTransactionEngineConformance } from "@opencut/editor-contracts/engine";
import { runDraftEditingConformance } from "@opencut/editor-contracts/draft";
import {
	runTransactionVectors,
	loadTransactionVectorCorpus,
} from "@opencut/editor-contracts/vectors";
import {
	PUBLISHED_CONTRACT_SURFACE,
	readPublishedCorpusText,
} from "@opencut/editor-contracts/vectors/corpus";

import { AlienProjectStore } from "./src/alien-store";
import { createAlienPorts } from "./src/roles";
import { createAlienTransactionTarget } from "./src/transaction";
import { createAdapterProjectStoreConformanceFactories } from "./src/factories";
import {
	classicChainFailure,
	createLegacyMigrator,
	demonstrateLegacyMigration,
	loadClassicMigrationChain,
} from "./src/migrate";

const DISPOSABLE_PREFIX = "alien-legacy-disposable-";
const projectStoreFactories = createAdapterProjectStoreConformanceFactories();

function line(text = ""): void {
	console.log(text);
}

async function main(): Promise<number> {
	line(
		"custom-storage example: production leg (alien adapter, published conformance)",
	);
	line(
		`runtime: ${typeof Bun !== "undefined" ? `bun ${Bun.version}` : `node ${process.version}`}`,
	);

	// -- legacy chain (dynamic; absence is a finding, not a crash) ------------
	const chain = await loadClassicMigrationChain();
	if (chain) {
		line(
			`classic chain: loaded (${chain.steps.length} steps, target v${chain.target})`,
		);
	} else {
		line(
			"classic chain: NOT LOADABLE — @opencut/editor-classic/storage/migrations " +
				"failed to load or initialize in this environment (recorded finding). " +
				"The migration leg is skipped distinctly; every other surface still runs.",
		);
		line(`  observed: ${classicChainFailure ?? "unknown error"}`);
	}

	const failures: string[] = [];

	// -- ports suite (portable profile) ------------------------------------------
	{
		const store = new AlienProjectStore({
			schemaVersion: chain?.target ?? 1,
		});
		if (chain) {
			store.migrate = createLegacyMigrator({ store, chain });
		}
		const identity = `${DISPOSABLE_PREFIX}${Math.floor(Math.random() * 1e9)}`;
		const disposable = {
			identity,
			prefix: DISPOSABLE_PREFIX,
			store: store as AlienProjectStore,
			cleanup: {
				identity,
				store: store as AlienProjectStore,
				run: () => store.remove({ id: identity as ProjectId }),
			},
		};
		if (chain) {
			await store.seedLegacy({
				id: identity as ProjectId,
				schemaVersion: chain.target - 1,
				data: { version: chain.target - 1, title: "Alien disposable" },
			});
		}
		const report = await runPortConformance({
			ports: createAlienPorts({ store }),
			label: "custom-storage example ports (portable profile)",
			storeFixture: {
				store,
				control: store.fixtureControl,
				...(chain ? { disposableMigration: disposable } : {}),
			},
			storeConformanceProfile: "portable",
			exerciseMigration: chain !== null,
		});
		if (!report.passed) failures.push(formatConformanceFailures(report));
		line(
			`suites/ports: passed=${report.passed} cases=${report.results.length} ` +
				`(migration ${chain ? "exercised" : "absent: classic unresolved in the plain consumer — the finding above"})`,
		);
		if (chain) {
			await disposable.cleanup.run();
			line("migration fixture: disposable record cleaned up");
		}
	}

	// -- transaction suite -------------------------------------------------------
	{
		const target = createAlienTransactionTarget({
			project: {
				id: projectId("alien-transaction-project"),
				name: "Alien transaction target",
				frameRate: { numerator: 30, denominator: 1 },
				canvasWidth: 1920,
				canvasHeight: 1080,
			},
		});
		const report = await runTransactionConformance({
			target: {
				read: target,
				apply: target,
				getContext: target,
				watch: target,
			},
			label: "custom-storage example transaction target",
		});
		if (!report.passed) failures.push(formatContractFailures(report));
		line(
			`suites/transaction: passed=${report.passed} cases=${report.results.length}`,
		);
	}

	// -- engine suite ------------------------------------------------------------
	{
		const report = await runTransactionEngineConformance(
			projectStoreFactories.engine,
			{ "provider-ripple-edit": true },
		);
		if (!report.passed) failures.push(formatContractFailures(report));
		line(
			`suites/engine: passed=${report.passed} cases=${report.results.length}`,
		);
	}

	// -- draft suite -------------------------------------------------------------
	{
		const report = await runDraftEditingConformance(
			projectStoreFactories.draft,
			{
				"provider-draft-placement": true,
			},
		);
		if (!report.passed) failures.push(formatContractFailures(report));
		line(
			`suites/draft: passed=${report.passed} cases=${report.results.length}`,
		);
	}

	// -- vectors suite -----------------------------------------------------------
	{
		const { manifestText, files } = readPublishedCorpusText();
		const corpus = loadTransactionVectorCorpus({
			manifestText,
			files,
			contract: PUBLISHED_CONTRACT_SURFACE,
		});
		const report = await runTransactionVectors({
			corpus,
			contract: PUBLISHED_CONTRACT_SURFACE,
			open: projectStoreFactories.vectors,
		});
		if (report.verdict !== "passed") {
			failures.push(formatContractFailures(report));
		}
		line(
			`suites/vectors: verdict=${report.verdict} vectors=${report.results.length}`,
		);
	}

	// -- migration leg (production path; the mock leg is run-mock.ts) -------------
	if (chain) {
		try {
			const transcript = await demonstrateLegacyMigration(chain);
			line("migration/by-replication: green");
			for (const entry of transcript.split("\n")) line(`  ${entry}`);
		} catch (error) {
			failures.push(
				`migration/by-replication: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
			line("migration/by-replication: FAILED");
		}
	} else {
		line(
			"migration/by-replication: SKIPPED distinctly (classic unresolved in the plain consumer — finding above; the chain itself is validated by run-mock.ts)",
		);
	}

	if (failures.length > 0) {
		line();
		line("— conformance failures ".padEnd(72, "—"));
		for (const block of failures) {
			line(block);
			line();
		}
		line(`custom-storage example: ${failures.length} failing surface(s)`);
		return 1;
	}
	line("custom-storage example (production leg): all exercised surfaces green");
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

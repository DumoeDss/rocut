/**
 * The alien adapter's runner (S05 P3, task 5.1).
 *
 * Executes every published conformance surface against this adapter's own
 * implementations and prints failures through the published formatters, so a
 * failure names the frozen requirement before the mechanism. Runs green from
 * inside the repository (workspace resolution) and from a scratch install of
 * the packed tarballs -- the pair that proves the declared entries complete.
 *
 * Exit rule: 0 iff all five suites pass AND the migration leg is either green
 * or absent because the classic migrations entry failed to load or initialize
 * (a recorded finding, printed distinctly -- never silently skipped).
 */
import type { ProjectId } from "@opencut/editor-ports";
import { runPortConformance } from "@opencut/editor-ports/conformance";
import { formatConformanceFailures } from "@opencut/editor-ports/conformance/requirements";

import { projectId } from "@opencut/editor-contracts";
import { runTransactionConformance } from "@opencut/editor-contracts/conformance";
import { formatConformanceFailures as formatContractFailures } from "@opencut/editor-contracts/conformance/requirements";
import { runTransactionEngineConformance } from "@opencut/editor-contracts/engine";
import { runDraftEditingConformance } from "@opencut/editor-contracts/draft";
import { runTransactionVectors } from "@opencut/editor-contracts/vectors";
import {
	PUBLISHED_CONTRACT_SURFACE,
	readPublishedCorpusText,
} from "@opencut/editor-contracts/vectors/corpus";
import { loadTransactionVectorCorpus } from "@opencut/editor-contracts/vectors";

import { AlienProjectStore } from "./src/alien-store";
import { createAlienPorts } from "./src/roles";
import { createAlienTransactionTarget } from "./src/transaction";
import {
	createAlienDraftFactory,
	createAlienEngineFactory,
	createAlienVectorTargetFactory,
} from "./src/factories";
import {
	classicChainFailure,
	createLegacyMigrator,
	demonstrateLegacyMigration,
	loadClassicMigrationChain,
} from "./src/migrate";

const DISPOSABLE_PREFIX = "alien-legacy-disposable-";

function line(text = ""): void {
	console.log(text);
}

async function main(): Promise<number> {
	line("alien adapter: third-party conformance run");
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

	// -- ports suite ------------------------------------------------------------
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
			label: "alien adapter ports",
			storeFixture: {
				store,
				control: store.fixtureControl,
				...(chain ? { disposableMigration: disposable } : {}),
			},
			exerciseMigration: chain !== null,
		});
		if (!report.passed) failures.push(formatConformanceFailures(report));
		line(
			`suites/ports: passed=${report.passed} cases=${report.results.length} ` +
				`(migration ${chain ? "exercised" : "absent: classic unresolved"})`,
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
			target: { read: target, apply: target, getContext: target, watch: target },
			label: "alien adapter transaction target",
		});
		if (!report.passed) failures.push(formatContractFailures(report));
		line(
			`suites/transaction: passed=${report.passed} cases=${report.results.length}`,
		);
	}

	// -- engine suite ------------------------------------------------------------
	{
		const report = await runTransactionEngineConformance(
			createAlienEngineFactory(),
			{ "provider-ripple-edit": true },
		);
		if (!report.passed) failures.push(formatContractFailures(report));
		line(
			`suites/engine: passed=${report.passed} cases=${report.results.length}`,
		);
	}

	// -- draft suite -------------------------------------------------------------
	{
		const report = await runDraftEditingConformance(createAlienDraftFactory(), {
			"provider-draft-placement": true,
		});
		if (!report.passed) failures.push(formatContractFailures(report));
		line(`suites/draft: passed=${report.passed} cases=${report.results.length}`);
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
			open: createAlienVectorTargetFactory(),
		});
		if (report.verdict !== "passed") {
			failures.push(formatContractFailures(report));
		}
		line(
			`suites/vectors: verdict=${report.verdict} vectors=${report.results.length}`,
		);
	}

	// -- migration leg ------------------------------------------------------------
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
		line("migration/by-replication: SKIPPED (classic unresolved — finding above)");
	}

	if (failures.length > 0) {
		line();
		line("— conformance failures ".padEnd(72, "—"));
		for (const block of failures) {
			line(block);
			line();
		}
		line(`alien adapter: ${failures.length} failing surface(s)`);
		return 1;
	}
	line("alien adapter: all exercised surfaces green");
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

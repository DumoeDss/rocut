/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- The durability controls submit deliberately hand-built operations outside the scenario plan. */
import { describe, expect, test } from "bun:test";

import { TransactionError } from "../..";
import {
	AGENT_LEDGER_SCHEMA,
	AGENT_SCENARIO,
	captureAgentCommitment,
	runAgentScenario,
	verifyAgentReopen,
} from "../agent-scenario";
import type { AgentLedger } from "../agent-scenario";
import {
	createDurableProjectStore,
	DURABLE_SCENARIO_PROJECT,
	openDurableTarget,
} from "../drivers/durable";
import {
	createInMemoryVectorTargetFactory,
	IN_MEMORY_SCENARIO_PROJECT,
} from "../drivers/in-memory";

const DECLARED = AGENT_SCENARIO.steps.map((step) => step.id);

/**
 * The comparison count each step of the declared plan executes.
 *
 * Pinned here and, identically, in `script/check-agent-evidence.mjs`, which
 * holds the browser Hosts to the same numbers. "The Hosts assert exactly what
 * the Node drivers assert" was previously read off a summary line and compared
 * by eye; these two pins are what make it a gate. A scenario change fails both,
 * in one obvious place each.
 */
const NODE_DRIVER_ASSERTIONS: Readonly<Record<string, number>> = {
	"build-structure": 23,
	"move-clip": 8,
	"trim-clip": 9,
	"split-clip": 12,
	"patch-project": 9,
	"keyed-commit": 8,
	"keyed-replay": 6,
	"keyed-reuse-different-payload": 5,
	"stale-expected-revision": 7,
};
const NODE_TOTAL_ASSERTIONS = Object.values(NODE_DRIVER_ASSERTIONS).reduce(
	(total, count) => total + count,
	0,
);

function assertLedgerIsSound(ledger: AgentLedger): void {
	expect(ledger.schema).toBe(AGENT_LEDGER_SCHEMA);
	expect(ledger.steps.flatMap((step) => step.failures)).toEqual([]);
	expect(ledger.failureCodes).toEqual([]);
	expect(ledger.verdict).toBe("passed");
	expect(ledger.executedSteps).toEqual(DECLARED);
	expect(ledger.declaredSteps).toEqual(DECLARED);
	expect(ledger.steps.length).toBe(DECLARED.length);
	for (const step of ledger.steps) {
		expect(step.assertionCount, `${step.id} asserted nothing`).toBeGreaterThan(0);
		expect(
			step.assertionCount,
			`${step.id} no longer asserts the pinned amount`,
		).toBe(NODE_DRIVER_ASSERTIONS[step.id] ?? -1);
		expect(step.applyCount).toBe(1);
		const declared = AGENT_SCENARIO.steps.find((entry) => entry.id === step.id);
		expect(step.revisionDelta).toBe(declared?.expect.revisionDelta ?? -1);
		expect(step.watcherCount).toBe(declared?.expect.watchDelta ?? -1);
	}
	expect(ledger.totalAssertions).toBe(
		ledger.steps.reduce((total, step) => total + step.assertionCount, 0),
	);
	expect(ledger.totalAssertions).toBe(NODE_TOTAL_ASSERTIONS);
	expect(ledger.commitment).not.toBeNull();
}

describe("the pinned Node ledger", () => {
	test("covers exactly the declared plan", () => {
		expect(Object.keys(NODE_DRIVER_ASSERTIONS).sort()).toEqual(
			[...DECLARED].sort(),
		);
	});
});

describe("driver 1 — the in-memory fake, without React, Electron or a browser", () => {
	test("runs the declared plan and emits a sound ledger", async () => {
		const handle = await createInMemoryVectorTargetFactory().openRelative({
			vectorId: AGENT_SCENARIO.id,
		});
		const ledger = await runAgentScenario({
			target: handle.target,
			driver: "node/in-memory",
			host: "node",
			buildMarker: "node-driver",
		});
		assertLedgerIsSound(ledger);
		expect(ledger.commitment?.projectId).toBe(IN_MEMORY_SCENARIO_PROJECT.id);
		// The fake has no store to observe, and the ledger says so rather than
		// reporting a zero it did not measure.
		for (const step of ledger.steps) expect(step.durableSaves).toBeNull();
		expect(typeof globalThis.document).toBe("undefined");
	});
});

describe("driver 2 — the durable engine over a project store", () => {
	async function openDurable() {
		const store = await createDurableProjectStore({
			project: DURABLE_SCENARIO_PROJECT,
		});
		const opened = await openDurableTarget({
			store,
			projectId: DURABLE_SCENARIO_PROJECT.id,
		});
		return { store, opened };
	}

	test("runs the declared plan, counts durable saves, and reopens on the committed revision", async () => {
		const { store, opened } = await openDurable();
		const ledger = await runAgentScenario({
			target: opened.engine,
			driver: "node/durable",
			host: "node",
			buildMarker: "node-driver",
			durableSaves: () => opened.control.saves(),
		});
		assertLedgerIsSound(ledger);

		const accepted = AGENT_SCENARIO.steps.filter(
			(step) => step.expect.outcome === "accepted",
		).length;
		const savesFromLedger = ledger.steps.reduce(
			(total, step) => total + (step.durableSaves ?? 0),
			0,
		);
		expect(savesFromLedger).toBe(accepted);
		for (const step of ledger.steps) {
			const declared = AGENT_SCENARIO.steps.find(
				(entry) => entry.id === step.id,
			);
			expect(step.durableSaves).toBe(
				declared?.expect.outcome === "accepted" ? 1 : 0,
			);
		}

		// A genuinely fresh engine over the same store, decoding the record again.
		const reopened = await openDurableTarget({
			store,
			projectId: DURABLE_SCENARIO_PROJECT.id,
		});
		const commitment = ledger.commitment!;
		const result = await verifyAgentReopen({
			target: reopened.engine,
			commitment,
		});
		expect(result.failures).toEqual([]);
		expect(result.verdict).toBe("passed");
		expect(result.observedRevision).toBe(commitment.revision);
		expect(result.assertionCount).toBeGreaterThan(
			commitment.tracks.length + commitment.clips.length,
		);
	});

	test("a stale reopen expectation fails the reopen step", async () => {
		const { store, opened } = await openDurable();
		const ledger = await runAgentScenario({
			target: opened.engine,
			driver: "node/durable",
			host: "node",
			buildMarker: "node-driver",
			durableSaves: () => opened.control.saves(),
		});
		const reopened = await openDurableTarget({
			store,
			projectId: DURABLE_SCENARIO_PROJECT.id,
		});
		const stale = {
			...ledger.commitment!,
			revision: ledger.commitment!.revision - 1,
		};
		const result = await verifyAgentReopen({
			target: reopened.engine,
			commitment: stale,
		});
		expect(result.verdict).toBe("failed");
		expect(result.failures.join(" ")).toContain("reopened revision");
		expect(result.observedRevision).toBe(ledger.commitment!.revision);
	});

	test("an injected durable failure moves nothing, is reported, and a later step still commits", async () => {
		const { opened } = await openDurable();
		const engine = opened.engine;
		await runAgentScenario({
			target: engine,
			driver: "node/durable",
			host: "node",
			buildMarker: "node-driver",
			stepIds: ["build-structure"],
		});

		const before = {
			revision: Number(await engine.revision()),
			markers: (await engine.markers()).length,
			saves: opened.control.saves(),
		};
		let watchCount = 0;
		const unwatch = engine.watch(() => {
			watchCount += 1;
		});

		opened.control.failNextSave(new Error("injected durable failure"));
		let rejected: unknown = null;
		try {
			await engine.apply({
				operations: [
					{
						kind: "create-marker",
						marker: { id: "control-marker", time: 4000 },
					} as never,
				],
			});
		} catch (error) {
			rejected = error;
		}
		expect(rejected).not.toBeNull();
		expect(rejected).not.toBeInstanceOf(TransactionError);
		expect(Number(await engine.revision())).toBe(before.revision);
		expect((await engine.markers()).length).toBe(before.markers);
		expect(
			(await engine.markers()).some(
				(marker) => String(marker.id) === "control-marker",
			),
		).toBe(false);
		expect(opened.control.saves()).toBe(before.saves);
		expect(watchCount).toBe(0);

		// The control is reported as a failed step, not skipped, and the engine
		// still accepts the next commit.
		const later = await engine.apply({
			operations: [
				{
					kind: "create-marker",
					marker: { id: "control-marker-later", time: 8000 },
				} as never,
			],
		});
		expect(Number(later.revision)).toBe(before.revision + 1);
		expect(opened.control.saves()).toBe(before.saves + 1);
		expect(watchCount).toBe(1);
		unwatch();
	});

	test("a store that parks its saves reaches the same verdicts once released", async () => {
		const { store, opened } = await openDurable();
		// The seed write already went through this store, so every count below is
		// a delta against what the run itself did.
		const before = {
			saves: opened.control.saves(),
			attempts: opened.control.attempts(),
		};
		const attempted = opened.control.whenSaveAttempted();
		const release = opened.control.blockSaves();
		const running = runAgentScenario({
			target: opened.engine,
			driver: "node/durable-parked",
			host: "node",
			buildMarker: "node-driver",
			durableSaves: () => opened.control.saves(),
		});

		// The first durable save is genuinely parked: nothing has committed, and
		// the run has not settled. Racing against an already-resolved marker is
		// the timer-free way to observe "still pending" — a driver that did not
		// wait for its save would have settled by now and lose the race.
		await attempted;
		expect(opened.control.attempts() - before.attempts).toBe(1);
		expect(opened.control.saves() - before.saves).toBe(0);
		expect(
			await Promise.race([
				running.then(() => "settled"),
				Promise.resolve("pending"),
			]),
		).toBe("pending");

		release();
		const ledger = await running;
		assertLedgerIsSound(ledger);
		const accepted = AGENT_SCENARIO.steps.filter(
			(step) => step.expect.outcome === "accepted",
		).length;
		expect(opened.control.saves() - before.saves).toBe(accepted);
		expect(opened.control.attempts() - before.attempts).toBe(accepted);

		const reopened = await openDurableTarget({
			store,
			projectId: DURABLE_SCENARIO_PROJECT.id,
		});
		const result = await verifyAgentReopen({
			target: reopened.engine,
			commitment: ledger.commitment!,
		});
		expect(result.verdict).toBe("passed");
		expect(result.observedRevision).toBe(ledger.commitment!.revision);
	});

	test("the two Node drivers commit the same identities from the same definition", async () => {
		const fake = await createInMemoryVectorTargetFactory().openRelative({
			vectorId: AGENT_SCENARIO.id,
		});
		const fakeLedger = await runAgentScenario({
			target: fake.target,
			driver: "node/in-memory",
			host: "node",
			buildMarker: "node-driver",
		});
		const { opened } = await openDurable();
		const durableLedger = await runAgentScenario({
			target: opened.engine,
			driver: "node/durable",
			host: "node",
			buildMarker: "node-driver",
		});
		const identities = (ledger: AgentLedger) =>
			[
				...ledger.commitment!.tracks,
				...ledger.commitment!.clips,
				...ledger.commitment!.assets,
				...ledger.commitment!.markers,
			]
				.map((entity) => String(entity.id))
				.sort();
		expect(identities(fakeLedger)).toEqual(identities(durableLedger));
		expect(identities(fakeLedger).length).toBeGreaterThan(4);
		expect(fakeLedger.commitment!.revision).toBe(
			durableLedger.commitment!.revision,
		);
	});

	test("captureAgentCommitment records only what the scenario created", async () => {
		const { opened } = await openDurable();
		await runAgentScenario({
			target: opened.engine,
			driver: "node/durable",
			host: "node",
			buildMarker: "node-driver",
			stepIds: ["build-structure"],
		});
		const commitment = await captureAgentCommitment(opened.engine);
		expect(commitment.tracks.map((track) => String(track.id))).toEqual([
			"agent-track-audio",
			"agent-track-caption",
		]);
		expect(commitment.projectId).toBe(DURABLE_SCENARIO_PROJECT.id);
	});
});

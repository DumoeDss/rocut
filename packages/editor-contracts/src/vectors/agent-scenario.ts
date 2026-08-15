/* eslint-disable @typescript-eslint/no-unsafe-type-assertion, opencut/prefer-object-params -- The ledger reads entities back as opaque records to compare declared fields, and canonical() is a one-argument formatter. */
/**
 * The Host-neutral Agent scenario and its ledger (S03 T4, design D6/D8).
 *
 * One definition, three drivers: the in-memory fake, a durable engine, and the
 * real session transaction facade inside each production Host. The definition
 * is a plain data structure over the frozen public surface — no donor schema,
 * no command class, no persistence call, no provider-private invocation — which
 * is what lets the same steps run in Node without React or Electron and in a
 * browser against a real project store.
 *
 * The plan below is a TypeScript mirror of the published corpus vector
 * `scenario/agent-transaction-walk`. It is deliberately a second artifact: the
 * browser driver must not pull committed corpus JSON into a Host bundle, and
 * `__tests__/agent-scenario.test.ts` asserts the two are identical, so changing
 * either one without the other fails.
 *
 * The ledger is part of the artifact rather than a report written afterwards. A
 * step that asserted nothing, an executed plan that differs from the declared
 * plan, or a driver that produced no ledger fails the run.
 */
import type { ScenarioStep, ScenarioVector } from "./schema";
import type { VectorTarget, VectorStepResult } from "./runner";
import { executeVectorStep } from "./runner";

export const AGENT_SCENARIO_ID = "scenario/agent-transaction-walk";
export const AGENT_SCENARIO_TITLE =
	"The Host-neutral agent walk: build, move, trim, split, patch the Project, replay, reuse, conflict";
export const AGENT_LEDGER_SCHEMA = "t4-agent-evidence-v1";

const AGENT_SCENARIO_STEPS: readonly ScenarioStep[] =
	[
		{
			"id": "build-structure",
			"intent": "create two lanes, one asset and two clips in one atomic batch",
			"batch": {
				"operations": [
					{
						"kind": "create-track",
						"track": {
							"id": "agent-track-caption",
							"kind": "text",
							"name": "Agent captions",
							"hidden": false,
						},
					},
					{
						"kind": "create-track",
						"track": {
							"id": "agent-track-audio",
							"kind": "audio",
							"name": "Agent audio",
							"hidden": false,
						},
					},
					{
						"kind": "create-asset",
						"asset": {
							"id": "agent-asset-score",
							"kind": "audio",
							"name": "Agent score",
							"duration": 480000,
						},
					},
					{
						"kind": "create-clip",
						"clip": {
							"id": "agent-clip-caption",
							"trackId": "agent-track-caption",
							"startTime": 0,
							"duration": 40000,
							"trimStart": 0,
							"trimEnd": 0,
						},
					},
					{
						"kind": "create-clip",
						"clip": {
							"id": "agent-clip-score",
							"trackId": "agent-track-audio",
							"assetId": "agent-asset-score",
							"startTime": 0,
							"duration": 120000,
							"trimStart": 0,
							"trimEnd": 0,
						},
					},
				],
			},
			"expect": {
				"outcome": "accepted",
				"revisionDelta": 1,
				"watchDelta": 1,
				"createdIds": [
					"agent-track-caption",
					"agent-track-audio",
					"agent-asset-score",
					"agent-clip-caption",
					"agent-clip-score",
				],
				"changedIds": [],
				"reads": [
					{
						"entity": "track",
						"id": "agent-track-caption",
						"fields": {
							"kind": "text",
							"name": "Agent captions",
							"hidden": false,
						},
					},
					{
						"entity": "track",
						"id": "agent-track-audio",
						"fields": {
							"kind": "audio",
							"name": "Agent audio",
						},
					},
					{
						"entity": "asset",
						"id": "agent-asset-score",
						"fields": {
							"kind": "audio",
							"name": "Agent score",
							"duration": 480000,
						},
					},
					{
						"entity": "clip",
						"id": "agent-clip-caption",
						"fields": {
							"trackId": "agent-track-caption",
							"startTime": 0,
							"duration": 40000,
							"trimStart": 0,
							"trimEnd": 0,
						},
					},
					{
						"entity": "clip",
						"id": "agent-clip-score",
						"fields": {
							"trackId": "agent-track-audio",
							"assetId": "agent-asset-score",
							"startTime": 0,
							"duration": 120000,
						},
					},
				],
			},
		},
		{
			"id": "move-clip",
			"intent": "move the caption clip along its own lane",
			"batch": {
				"operations": [
					{
						"kind": "update-clip",
						"clipId": "agent-clip-caption",
						"patch": {
							"startTime": 80000,
						},
					},
				],
			},
			"expect": {
				"outcome": "accepted",
				"revisionDelta": 1,
				"watchDelta": 1,
				"createdIds": [],
				"changedIds": [
					"agent-clip-caption",
				],
				"reads": [
					{
						"entity": "clip",
						"id": "agent-clip-caption",
						"fields": {
							"startTime": 80000,
							"duration": 40000,
						},
					},
				],
			},
		},
		{
			"id": "trim-clip",
			"intent": "trim the score clip inside its source bounds",
			"batch": {
				"operations": [
					{
						"kind": "update-clip",
						"clipId": "agent-clip-score",
						"patch": {
							"duration": 80000,
							"trimStart": 4000,
						},
					},
				],
			},
			"expect": {
				"outcome": "accepted",
				"revisionDelta": 1,
				"watchDelta": 1,
				"createdIds": [],
				"changedIds": [
					"agent-clip-score",
				],
				"reads": [
					{
						"entity": "clip",
						"id": "agent-clip-score",
						"fields": {
							"duration": 80000,
							"trimStart": 4000,
							"trimEnd": 0,
						},
					},
				],
			},
		},
		{
			"id": "split-clip",
			"intent": "split the caption clip into a head and a tail in one atomic batch",
			"batch": {
				"operations": [
					{
						"kind": "update-clip",
						"clipId": "agent-clip-caption",
						"patch": {
							"duration": 20000,
						},
					},
					{
						"kind": "create-clip",
						"clip": {
							"id": "agent-clip-caption-tail",
							"trackId": "agent-track-caption",
							"startTime": 100000,
							"duration": 20000,
							"trimStart": 20000,
							"trimEnd": 0,
						},
					},
				],
			},
			"expect": {
				"outcome": "accepted",
				"revisionDelta": 1,
				"watchDelta": 1,
				"createdIds": [
					"agent-clip-caption-tail",
				],
				"changedIds": [
					"agent-clip-caption",
				],
				"reads": [
					{
						"entity": "clip",
						"id": "agent-clip-caption",
						"fields": {
							"startTime": 80000,
							"duration": 20000,
						},
					},
					{
						"entity": "clip",
						"id": "agent-clip-caption-tail",
						"fields": {
							"startTime": 100000,
							"duration": 20000,
							"trimStart": 20000,
							"trackId": "agent-track-caption",
						},
					},
				],
			},
		},
		{
			"id": "patch-project",
			"intent": "submit one typed Project patch",
			"batch": {
				"operations": [
					{
						"kind": "update-project",
						"projectId": "$project",
						"patch": {
							"name": "Agent transaction walk",
							"canvasWidth": 1280,
							"canvasHeight": 720,
						},
					},
				],
			},
			"expect": {
				"outcome": "accepted",
				"revisionDelta": 1,
				"watchDelta": 1,
				"createdIds": [],
				"changedIds": [
					"$project",
				],
				"reads": [
					{
						"entity": "project",
						"id": "$project",
						"fields": {
							"name": "Agent transaction walk",
							"canvasWidth": 1280,
							"canvasHeight": 720,
						},
					},
				],
			},
		},
		{
			"id": "keyed-commit",
			"intent": "commit a keyed batch that the next step replays",
			"batch": {
				"idempotencyKey": "agent-walk-key",
				"operations": [
					{
						"kind": "create-marker",
						"marker": {
							"id": "agent-marker-cue",
							"time": 40000,
							"note": "cue",
						},
					},
				],
			},
			"expect": {
				"outcome": "accepted",
				"revisionDelta": 1,
				"watchDelta": 1,
				"createdIds": [
					"agent-marker-cue",
				],
				"changedIds": [],
				"reads": [
					{
						"entity": "marker",
						"id": "agent-marker-cue",
						"fields": {
							"time": 40000,
							"note": "cue",
						},
					},
				],
			},
		},
		{
			"id": "keyed-replay",
			"intent": "replay the keyed batch unchanged",
			"batch": {
				"idempotencyKey": "agent-walk-key",
				"operations": [
					{
						"kind": "create-marker",
						"marker": {
							"id": "agent-marker-cue",
							"time": 40000,
							"note": "cue",
						},
					},
				],
			},
			"expect": {
				"outcome": "replayed",
				"revisionDelta": 0,
				"watchDelta": 0,
				"createdIds": [
					"agent-marker-cue",
				],
				"changedIds": [],
			},
		},
		{
			"id": "keyed-reuse-different-payload",
			"intent": "reuse the key with a different payload",
			"batch": {
				"idempotencyKey": "agent-walk-key",
				"operations": [
					{
						"kind": "create-marker",
						"marker": {
							"id": "agent-marker-other",
							"time": 44000,
						},
					},
				],
			},
			"expect": {
				"outcome": "rejected",
				"errorCode": "duplicate",
				"revisionDelta": 0,
				"watchDelta": 0,
				"reads": [
					{
						"entity": "marker",
						"id": "agent-marker-other",
						"absent": true,
					},
				],
			},
		},
		{
			"id": "stale-expected-revision",
			"intent": "submit a stale expected revision",
			"batch": {
				"expectedRevisionOffset": -1,
				"operations": [
					{
						"kind": "update-clip",
						"clipId": "agent-clip-caption",
						"patch": {
							"startTime": 160000,
						},
					},
				],
			},
			"expect": {
				"outcome": "rejected",
				"errorCode": "conflict",
				"revisionDelta": 0,
				"watchDelta": 0,
				"reads": [
					{
						"entity": "clip",
						"id": "agent-clip-caption",
						"fields": {
							"startTime": 80000,
							"duration": 20000,
						},
					},
				],
			},
		},
	];

/** The one Host-neutral scenario every driver executes. */
export const AGENT_SCENARIO: ScenarioVector = {
	id: AGENT_SCENARIO_ID,
	title: AGENT_SCENARIO_TITLE,
	steps: AGENT_SCENARIO_STEPS,
};

export interface AgentLedgerStep {
	readonly id: string;
	readonly intent: string;
	readonly baseRevision: number;
	readonly resultRevision: number | null;
	readonly revisionDelta: number;
	readonly applyCount: number;
	/** Durable saves observed across the step, or `null` where unobservable. */
	readonly durableSaves: number | null;
	readonly watcherCount: number;
	readonly assertionCount: number;
	readonly verdict: "passed" | "failed";
	readonly failures: readonly string[];
}

/**
 * What the apply phase committed, read back from the target rather than
 * declared. The reopen assertion compares against these observed values, so it
 * is bound to what this run actually committed.
 */
export interface AgentCommitment {
	readonly revision: number;
	readonly projectId: string;
	readonly project: Readonly<Record<string, unknown>>;
	readonly tracks: readonly Readonly<Record<string, unknown>>[];
	readonly clips: readonly Readonly<Record<string, unknown>>[];
	readonly assets: readonly Readonly<Record<string, unknown>>[];
	readonly markers: readonly Readonly<Record<string, unknown>>[];
}

export interface AgentLedger {
	readonly schema: typeof AGENT_LEDGER_SCHEMA;
	readonly scenarioId: string;
	readonly driver: string;
	readonly host: string;
	readonly buildMarker: string;
	readonly declaredSteps: readonly string[];
	readonly executedSteps: readonly string[];
	readonly steps: readonly AgentLedgerStep[];
	readonly totalAssertions: number;
	readonly commitment: AgentCommitment | null;
	readonly verdict: "passed" | "failed";
	readonly failureCodes: readonly string[];
}

/** Identities the scenario itself introduces, read out of the plan. */
export function agentScenarioCreatedIds(): readonly string[] {
	const created = new Set<string>();
	for (const step of AGENT_SCENARIO.steps) {
		for (const id of step.expect.createdIds ?? []) created.add(id);
	}
	return [...created].sort();
}

function entityFields(
	value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
	const copy: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(value)) {
		copy[key] =
			typeof entry === "object" && entry !== null ? { ...entry } : entry;
	}
	return copy;
}

/**
 * Read back everything the scenario created, plus the exact revision the target
 * reports now. This is the value the reopen step is bound to.
 */
export async function captureAgentCommitment(
	target: VectorTarget,
): Promise<AgentCommitment> {
	const created = new Set(agentScenarioCreatedIds());
	const project = await target.project();
	if (!project) throw new Error("The agent scenario requires a Project");
	const [tracks, clips, assets, markers] = await Promise.all([
		target.tracks(),
		target.clips(),
		target.assets(),
		target.markers(),
	]);
	const mine = (values: readonly { readonly id: string }[]) =>
		values
			.filter((value) => created.has(String(value.id)))
			.map((value) => entityFields(value as Readonly<Record<string, unknown>>))
			.sort((left, right) => String(left.id).localeCompare(String(right.id)));
	return {
		revision: Number(await target.revision()),
		projectId: String(project.id),
		project: entityFields(project as unknown as Record<string, unknown>),
		tracks: mine(tracks),
		clips: mine(clips),
		assets: mine(assets),
		markers: mine(markers),
	};
}

function canonical(value: unknown): string {
	if (value === null || value === undefined) return String(value);
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (typeof value === "object") {
		const record = value as Record<string, unknown>;
		return `{${Object.keys(record)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
			.join(",")}}`;
	}
	return JSON.stringify(value) ?? String(value);
}

export interface AgentReopenResult {
	readonly assertionCount: number;
	readonly observedRevision: number;
	readonly expectedRevision: number;
	readonly verdict: "passed" | "failed";
	readonly failures: readonly string[];
}

/**
 * Assert a freshly opened target reports the exact revision this run committed
 * and still holds every entity it created, field for field.
 */
export async function verifyAgentReopen(args: {
	readonly target: VectorTarget;
	readonly commitment: AgentCommitment;
}): Promise<AgentReopenResult> {
	const failures: string[] = [];
	let assertionCount = 0;
	const check = (passed: boolean, detail: string) => {
		assertionCount += 1;
		if (!passed) failures.push(detail);
	};

	const observedRevision = Number(await args.target.revision());
	check(
		observedRevision === args.commitment.revision,
		`reopened revision ${observedRevision} != committed ${args.commitment.revision}`,
	);

	const project = await args.target.project();
	check(project !== null, "the reopened target holds no Project");
	if (project) {
		const reopened = project as unknown as Record<string, unknown>;
		for (const [field, expected] of Object.entries(args.commitment.project)) {
			check(
				canonical(reopened[field]) === canonical(expected),
				`reopened project.${field} is ${canonical(reopened[field])}, committed ${canonical(expected)}`,
			);
		}
	}

	const observed = {
		tracks: await args.target.tracks(),
		clips: await args.target.clips(),
		assets: await args.target.assets(),
		markers: await args.target.markers(),
	} as const;
	for (const kind of ["tracks", "clips", "assets", "markers"] as const) {
		for (const committed of args.commitment[kind]) {
			const found = observed[kind].find(
				(value) => String(value.id) === String(committed.id),
			) as Readonly<Record<string, unknown>> | undefined;
			check(
				found !== undefined,
				`reopened ${kind} is missing ${String(committed.id)}`,
			);
			if (!found) continue;
			for (const [field, expected] of Object.entries(committed)) {
				check(
					canonical(found[field]) === canonical(expected),
					`reopened ${kind} ${String(committed.id)}.${field} is ${canonical(found[field])}, committed ${canonical(expected)}`,
				);
			}
		}
	}

	if (assertionCount === 0) failures.push("the reopen step asserted nothing");
	return {
		assertionCount,
		observedRevision,
		expectedRevision: args.commitment.revision,
		verdict: failures.length === 0 ? "passed" : "failed",
		failures,
	};
}

/**
 * The ledger's own accounting rules, applied to whatever the run produced.
 *
 * Exported so the controls can drive each rule directly: a step that asserted
 * nothing, an executed plan that differs from the declared one, and a run with
 * no step at all must each name a failure code.
 */
export function agentLedgerFailureCodes(args: {
	readonly declaredSteps: readonly string[];
	readonly steps: readonly AgentLedgerStep[];
	readonly extraCodes?: readonly string[];
}): readonly string[] {
	const codes = new Set<string>(args.extraCodes ?? []);
	for (const step of args.steps) {
		if (step.assertionCount === 0) codes.add("zero-assertion-step");
		if (step.verdict === "failed") codes.add("step-failed");
	}
	const executed = args.steps.map((step) => step.id);
	if (executed.join("|") !== args.declaredSteps.join("|")) {
		codes.add("step-plan-drift");
	}
	if (args.steps.length === 0) codes.add("empty-run");
	return [...codes].sort();
}

export interface RunAgentScenarioArgs {
	readonly target: VectorTarget;
	readonly driver: string;
	readonly host: string;
	readonly buildMarker: string;
	/** Cumulative durable saves, where the driver can observe the store. */
	readonly durableSaves?: () => number;
	/** Steps to run; defaults to the whole declared plan. */
	readonly stepIds?: readonly string[];
}

/**
 * Execute the declared plan against one target and emit the ledger.
 *
 * The verdict is computed from the run: a step that asserted nothing, a step
 * that failed a comparison, or an executed plan that differs from the declared
 * one all produce a failure code. No number in the ledger is a literal.
 */
export async function runAgentScenario(
	args: RunAgentScenarioArgs,
): Promise<AgentLedger> {
	const declared = AGENT_SCENARIO.steps.filter(
		(step) => args.stepIds === undefined || args.stepIds.includes(step.id),
	);
	const steps: AgentLedgerStep[] = [];
	const failureCodes = new Set<string>();

	for (const step of declared) {
		const savesBefore = args.durableSaves?.() ?? null;
		let result: VectorStepResult;
		try {
			result = await executeVectorStep({
				target: args.target,
				stepId: step.id,
				batch: step.batch,
				expect: step.expect,
			});
		} catch (error) {
			failureCodes.add("step-threw");
			steps.push({
				id: step.id,
				intent: step.intent,
				baseRevision: -1,
				resultRevision: null,
				revisionDelta: 0,
				applyCount: 1,
				durableSaves:
					savesBefore === null
						? null
						: (args.durableSaves?.() ?? 0) - savesBefore,
				watcherCount: 0,
				assertionCount: 0,
				verdict: "failed",
				failures: [error instanceof Error ? error.message : String(error)],
			});
			continue;
		}
		const savesAfter = args.durableSaves?.() ?? null;
		const entry: AgentLedgerStep = {
			id: step.id,
			intent: step.intent,
			baseRevision: result.baseRevision,
			resultRevision: result.resultRevision,
			revisionDelta: result.revisionDelta,
			applyCount: 1,
			durableSaves:
				savesBefore === null || savesAfter === null
					? null
					: savesAfter - savesBefore,
			watcherCount: result.watchDelta,
			assertionCount: result.comparisons,
			verdict: result.failures.length === 0 ? "passed" : "failed",
			failures: result.failures,
		};
		steps.push(entry);
	}

	const executedSteps = steps.map((step) => step.id);
	const declaredSteps = declared.map((step) => step.id);

	let commitment: AgentCommitment | null = null;
	try {
		commitment = await captureAgentCommitment(args.target);
	} catch {
		failureCodes.add("no-commitment");
	}
	for (const code of agentLedgerFailureCodes({
		declaredSteps,
		steps,
		extraCodes: [...failureCodes],
	})) {
		failureCodes.add(code);
	}

	return {
		schema: AGENT_LEDGER_SCHEMA,
		scenarioId: AGENT_SCENARIO_ID,
		driver: args.driver,
		host: args.host,
		buildMarker: args.buildMarker,
		declaredSteps,
		executedSteps,
		steps,
		totalAssertions: steps.reduce(
			(total, step) => total + step.assertionCount,
			0,
		),
		commitment,
		verdict: failureCodes.size === 0 ? "passed" : "failed",
		failureCodes: [...failureCodes].sort(),
	};
}

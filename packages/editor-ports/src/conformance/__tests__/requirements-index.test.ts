import { describe, expect, test } from "bun:test";

import { runPortConformance } from "../index";
import {
	createInMemoryPorts,
	createInMemoryProjectStoreFixture,
	InMemoryProjectStore,
} from "../../in-memory";
import {
	PORT_CONFORMANCE_REQUIREMENTS,
	formatConformanceFailures,
	portRequirementOf,
} from "../requirements";

/**
 * The requirement-index drift guard (S05 P3, spec scenario "The index cannot
 * drift from the suites").
 *
 * The index in `../requirements.ts` is authored by reading the suite, never by
 * editing it — the suite module is frozen and stays diff-empty. This test is
 * what makes that authorship safe: it runs the suite against the in-memory
 * reference implementation and refuses any reported case name — passed, failed
 * or skipped — that has no index row, and refuses any row whose case no run
 * reports. A case renamed or added in the suite without its row moving turns
 * this test red rather than shipping a reader a name the formatter cannot
 * attribute.
 */

/** The synthetic name the suite reports for an uncovered port role. */
const SENTINEL = "the suite covers this port";

function missingRows(names: readonly string[]): string[] {
	return names.filter((name) => portRequirementOf(name) === undefined);
}

describe("the port conformance requirement index", () => {
	test("every case name the suite reports has an index row", async () => {
		const fixture = createInMemoryProjectStoreFixture();
		const report = await runPortConformance({
			ports: createInMemoryPorts({ store: fixture.store }),
			storeFixture: fixture,
			label: "requirement-index guard",
		});
		// The reference implementation is green, so every status the suite can
		// report for it — passed and skipped alike — reaches the guard below.
		expect(report.passed).toBe(true);
		expect(report.results.length).toBeGreaterThan(0);
		expect(missingRows(report.results.map((result) => result.name))).toEqual(
			[],
		);
	});

	test("no index row is a name no suite run reports (stale rows)", async () => {
		// The converse of the guard above: a row whose case never appears is a
		// stale spelling left behind by a rename, and the formatter would render
		// it for nothing. The sentinel is the one deliberate exception — it is
		// reported only against a role with no cases at all, which the reference
		// implementation never produces.
		const fixture = createInMemoryProjectStoreFixture();
		const report = await runPortConformance({
			ports: createInMemoryPorts({ store: fixture.store }),
			storeFixture: fixture,
			label: "requirement-index guard (reverse)",
		});
		const reported = new Set(report.results.map((result) => result.name));
		expect(reported.has(SENTINEL)).toBe(false);
		expect(
			Object.keys(PORT_CONFORMANCE_REQUIREMENTS).filter(
				(name) => name !== SENTINEL && !reported.has(name),
			),
		).toEqual([]);
	});

	test("a synthetic renamed case fails the guard (violation-and-revert)", async () => {
		// Prove the guard discriminates: rename one real reported case and
		// require the same predicate to flag it, then confirm the unmodified
		// report stays clean. This is the drift the guard exists to catch — a
		// suite case renamed without its index row moving with it.
		const fixture = createInMemoryProjectStoreFixture();
		const report = await runPortConformance({
			ports: createInMemoryPorts({ store: fixture.store }),
			storeFixture: fixture,
			label: "requirement-index guard (violation leg)",
		});
		const realName = report.results[0]!.name;
		const renamed = `renamed-by-violation: ${realName}`;
		expect(portRequirementOf(renamed)).toBeUndefined();
		expect(
			missingRows([
				renamed,
				...report.results.slice(1).map((result) => result.name),
			]),
		).toEqual([renamed]);
		// Revert: the unmodified report is clean.
		expect(missingRows(report.results.map((result) => result.name))).toEqual(
			[],
		);
	});

	test("the formatter renders requirement-first with no stack, on a real failing report", async () => {
		// Task 3.3's formatter proof on real input: the repo's own negative
		// control — a store that normalizes the opaque payload on load — run
		// through the suite and rendered by the published formatter. The first
		// failure names the frozen requirement before the case, and the output
		// carries no stack frames.
		class NormalizingStore extends InMemoryProjectStore {
			override async load(args: { id: string }) {
				const record = await super.load(args);
				if (!record) return null;
				return { ...record, data: { normalized: true } };
			}
		}
		const report = await runPortConformance({
			ports: createInMemoryPorts({ store: new NormalizingStore() }),
			label: "json-normalizing store",
		});
		expect(report.passed).toBe(false);
		const rendered = formatConformanceFailures(report);
		// eslint-disable-next-line no-console -- the worked example in requirements.ts is this capture.
		console.log(rendered);
		const firstFailure = report.results.find(
			(result) => result.status === "failed",
		);
		expect(firstFailure).toBeDefined();
		const entry = portRequirementOf(firstFailure!.name);
		expect(entry).toBeDefined();
		const requirementLine = `[${entry!.requirement}]`;
		expect(rendered).toContain(requirementLine);
		expect(rendered.indexOf(requirementLine)).toBeLessThan(
			rendered.indexOf(`case: ${firstFailure!.name}`),
		);
		expect(rendered).not.toMatch(/\n\s*at\s/);
		expect(rendered).not.toMatch(/    at /);
	});
});

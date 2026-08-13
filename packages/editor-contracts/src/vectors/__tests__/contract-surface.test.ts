import { describe, expect, test } from "bun:test";

import { OPERATION_KINDS } from "../..";
import type { TransactionErrorCode } from "../..";
import type { TransactionEngineIssueCode } from "../../engine";
import { parseContractSurface } from "../contract-surface";
import { TransactionVectorError } from "../schema";
import { readContractSources, readContractSurface } from "./corpus-fixture";

/**
 * The coverage gate reads the contract out of its own source text, because two
 * of its three member sets are type-only unions. These tests are what make that
 * parse trustworthy: one side is checked against the *value* the contract
 * exports, and the other two against exhaustive `Record<Union, true>` literals
 * the compiler refuses unless they name exactly the union's members.
 */

// If a member is added to or removed from either union, these literals stop
// compiling — which is the point. They are a compiler-enforced restatement,
// never an input to the gate.
const ERROR_CODES: Record<TransactionErrorCode, true> = {
	conflict: true,
	validation: true,
	"not-found": true,
	duplicate: true,
	unsupported: true,
};

const ISSUE_CODES: Record<TransactionEngineIssueCode, true> = {
	"empty-batch": true,
	"duplicate-id": true,
	"missing-relation": true,
	"not-found": true,
	"unsupported-operation": true,
	"expected-revision-conflict": true,
	"idempotency-conflict": true,
	"invalid-entity": true,
	"non-positive-duration": true,
	"timebase-misaligned": true,
	collision: true,
	"lane-incompatible": true,
	"source-out-of-bounds": true,
};

describe("contract surface derivation", () => {
	test("the parsed operation kinds are the exported constant, member for member", () => {
		const surface = readContractSurface();
		expect(surface.operationKinds).toEqual([...OPERATION_KINDS]);
		expect(surface.operationKinds.length).toBeGreaterThan(0);
	});

	test("the parsed error codes are exactly the union's members", () => {
		const surface = readContractSurface();
		expect([...surface.errorCodes].sort()).toEqual(
			Object.keys(ERROR_CODES).sort(),
		);
	});

	test("the parsed engine issue codes are exactly the union's members", () => {
		const surface = readContractSurface();
		expect([...surface.issueCodes].sort()).toEqual(
			Object.keys(ISSUE_CODES).sort(),
		);
	});

	test("a source that does not declare a member set is refused, not defaulted", () => {
		const sources = readContractSources();
		expect(() =>
			parseContractSurface({ ...sources, transaction: "export const x = 1;\n" }),
		).toThrow(TransactionVectorError);
		expect(() =>
			parseContractSurface({
				...sources,
				operations: "export const OPERATION_KINDS = [] as const;\n",
			}),
		).toThrow(/parsed empty/);
	});

	test("a synthetic member added to the contract source is seen by the parser", () => {
		const sources = readContractSources();
		const surface = parseContractSurface({
			...sources,
			transaction: sources.transaction.replace(
				'| "unsupported";',
				'| "unsupported"\n\t| "synthetic-code";',
			),
		});
		expect(surface.errorCodes).toContain("synthetic-code");
	});
});

import { expect, test } from "bun:test";
import { ProjectStoreError } from "@opencut/editor-ports";
import { TransactionError, revisionOf } from "@opencut/editor-contracts";
import { describePersistenceFailure } from "../persistence-diagnostics";

const privatePayload = "provider-private-payload-must-not-leak";

test("storage errors expose only their stable failure code", () => {
	for (const code of [
		"aborted",
		"quota-exceeded",
		"unavailable",
		"corrupt",
		"conflict",
	] as const) {
		const error = new ProjectStoreError({
			code,
			operation: "save-project",
			scope: { kind: "project", projectId: privatePayload },
			message: privatePayload,
		});
		expect(describePersistenceFailure({ error })).toEqual({ code });
	}
});

test("transaction failures retain numeric troubleshooting context without payloads", () => {
	const error = new TransactionError({
		code: "conflict",
		message: privatePayload,
		operationIndex: 0,
		expectedRevision: revisionOf(4),
		actualRevision: revisionOf(7),
	});
	expect(describePersistenceFailure({ error })).toEqual({
		code: "conflict",
		name: "TransactionError",
		operationIndex: 0,
		expectedRevision: 4,
		actualRevision: 7,
	});
});

test("unknown failures never serialize raw names, codes, messages or thrown values", () => {
	for (const error of [
		null,
		undefined,
		privatePayload,
		Symbol(privatePayload),
		new Error(privatePayload),
		{
			name: privatePayload,
			code: privatePayload,
			message: privatePayload,
			cause: { payload: privatePayload },
		},
	]) {
		expect(describePersistenceFailure({ error })).toEqual({ code: "unknown" });
	}
});

test("malformed transaction metadata is not coerced into loggable strings", () => {
	const untrustedRevision = {
		toString: () => {
			throw new Error("must not coerce");
		},
	};
	for (const value of [
		privatePayload,
		untrustedRevision,
		-1,
		0.5,
		NaN,
		Infinity,
		Number.MAX_SAFE_INTEGER + 1,
	]) {
		const result = describePersistenceFailure({
			error: {
				name: "TransactionError",
				code: "validation",
				message: privatePayload,
				operationIndex: value,
				expectedRevision: value,
				actualRevision: value,
			},
		});
		expect(result).toEqual({ code: "validation", name: "TransactionError" });
		expect(JSON.stringify(result)).not.toContain(privatePayload);
	}
});

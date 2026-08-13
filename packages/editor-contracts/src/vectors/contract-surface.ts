/**
 * The contract surface the coverage gate measures against (design D3).
 *
 * Coverage is a claim about the *contract*, so it must be derived from the
 * contract and not from a list restated here or inside the corpus. One of the
 * three members is a runtime constant (`OPERATION_KINDS`); the other two are
 * type-only unions with no runtime representation, so this module reads them
 * out of the contract's own source text.
 *
 * That parse is itself checked, not trusted: `contract-surface.test.ts` compares
 * the parsed operation kinds against the imported `OPERATION_KINDS` value and
 * the parsed code sets against exhaustive `Record<Union, true>` literals, which
 * the compiler refuses to accept if a member is missing or invented. A drifting
 * parser therefore fails the suite rather than quietly shrinking the gate.
 *
 * Parsing is pure — the caller supplies the source text — so the runner keeps
 * its no-file-system property.
 */
import { TransactionVectorError } from "./schema";

export interface ContractSurface {
	readonly operationKinds: readonly string[];
	readonly errorCodes: readonly string[];
	readonly issueCodes: readonly string[];
}

export interface ContractSurfaceSources {
	/** `apps/web/src/editor/contracts/operations.ts` */
	readonly operations: string;
	/** `apps/web/src/editor/contracts/transaction.ts` */
	readonly transaction: string;
	/** `apps/web/src/editor/contracts/engine/types.ts` */
	readonly engineTypes: string;
}

function refuse(args: { readonly message: string; readonly field: string }): never {
	throw new TransactionVectorError({
		code: "schema",
		message: args.message,
		field: args.field,
	});
}

function stringLiterals(fragment: string): string[] {
	return [...fragment.matchAll(/"([^"\\]+)"/g)].map((match) => match[1]);
}

function sliceBetween(args: {
	readonly source: string;
	readonly start: string;
	readonly end: string;
	readonly field: string;
}): string {
	const startIndex = args.source.indexOf(args.start);
	if (startIndex < 0) {
		refuse({
			message: `Contract source does not declare ${args.start}`,
			field: args.field,
		});
	}
	const endIndex = args.source.indexOf(args.end, startIndex);
	if (endIndex < 0) {
		refuse({
			message: `Contract declaration of ${args.start} is unterminated`,
			field: args.field,
		});
	}
	return args.source.slice(startIndex + args.start.length, endIndex);
}

function requireMembers(args: {
	readonly members: readonly string[];
	readonly field: string;
}): readonly string[] {
	if (args.members.length === 0) {
		refuse({
			message: `Contract surface member set ${args.field} parsed empty`,
			field: args.field,
		});
	}
	const unique = new Set(args.members);
	if (unique.size !== args.members.length) {
		refuse({
			message: `Contract surface member set ${args.field} repeats a member`,
			field: args.field,
		});
	}
	return args.members;
}

/**
 * Read the operation-kind constant and the two closed code unions out of the
 * contract's source text.
 */
export function parseContractSurface(
	sources: ContractSurfaceSources,
): ContractSurface {
	const operationKinds = stringLiterals(
		sliceBetween({
			source: sources.operations,
			start: "export const OPERATION_KINDS = [",
			end: "] as const;",
			field: "OPERATION_KINDS",
		}),
	);
	const errorCodes = stringLiterals(
		sliceBetween({
			source: sources.transaction,
			start: "export type TransactionErrorCode =",
			end: ";",
			field: "TransactionErrorCode",
		}),
	);
	const issueCodes = stringLiterals(
		sliceBetween({
			source: sources.engineTypes,
			start: "export type TransactionEngineIssueCode =",
			end: ";",
			field: "TransactionEngineIssueCode",
		}),
	);
	return {
		operationKinds: requireMembers({
			members: operationKinds,
			field: "OPERATION_KINDS",
		}),
		errorCodes: requireMembers({
			members: errorCodes,
			field: "TransactionErrorCode",
		}),
		issueCodes: requireMembers({
			members: issueCodes,
			field: "TransactionEngineIssueCode",
		}),
	};
}

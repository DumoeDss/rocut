import type { OperationKind } from "..";
import { OPERATION_KINDS } from "..";
import type {
	DraftSafeOperation,
	ImmediateOperationDescriptor,
	ImmediateOperationKind,
} from "./types";
import { IMMEDIATE_OPERATION_KINDS } from "./types";

export const DRAFT_OPERATION_CLASSIFICATION = {
	"create-track": "draft-safe",
	"update-track": "draft-safe",
	"delete-track": "draft-safe",
	"create-clip": "draft-safe",
	"update-clip": "draft-safe",
	"delete-clip": "draft-safe",
	"create-asset": "draft-safe",
	"delete-asset": "draft-safe",
	"create-marker": "draft-safe",
	"update-marker": "draft-safe",
	"delete-marker": "draft-safe",
	"update-project": "draft-safe",
} as const satisfies Readonly<Record<OperationKind, "draft-safe">>;

export const IMMEDIATE_OPERATION_CLASSIFICATION = {
	"media-generation": "immediate",
	"project-export": "immediate",
	"source-package-removal": "immediate",
	"external-resource-deletion": "immediate",
	"external-side-effect": "immediate",
} as const satisfies Readonly<Record<ImmediateOperationKind, "immediate">>;

export const IMMEDIATE_OPERATION_DESCRIPTORS: readonly ImmediateOperationDescriptor[] =
	Object.freeze(
		IMMEDIATE_OPERATION_KINDS.map((kind) =>
			Object.freeze({ kind, handling: "immediate" as const }),
		),
	);

const draftKinds = new Set<string>(OPERATION_KINDS);
const immediateKinds = new Set<string>(IMMEDIATE_OPERATION_KINDS);

function operationKindOf(value: unknown): string {
	if (value === null || typeof value !== "object") return String(value);
	const kind = Reflect.get(value, "kind");
	return typeof kind === "string" ? kind : String(kind);
}

export type DraftRuntimeClassification =
	| { readonly handling: "draft-safe"; readonly operation: DraftSafeOperation }
	| { readonly handling: "immediate"; readonly kind: ImmediateOperationKind }
	| { readonly handling: "unsupported"; readonly kind: string };

export function classifyDraftRuntimeOperation(
	value: unknown,
): DraftRuntimeClassification {
	const kind = operationKindOf(value);
	if (draftKinds.has(kind)) {
		return {
			handling: "draft-safe",
			operation: value as DraftSafeOperation,
		};
	}
	if (immediateKinds.has(kind)) {
		return { handling: "immediate", kind: kind as ImmediateOperationKind };
	}
	return { handling: "unsupported", kind };
}

export function isDraftSafeOperation(
	value: unknown,
): value is DraftSafeOperation {
	return classifyDraftRuntimeOperation(value).handling === "draft-safe";
}

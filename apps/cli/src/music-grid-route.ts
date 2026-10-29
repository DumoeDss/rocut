import type { AutomationApi } from "@opencut/editor-automation";
import type {
	MusicGridEditRequest,
	MusicGridQuery,
	MusicGridSourceAvailabilityProbe,
} from "@opencut/editor-contracts";
import {
	editMusicGrid,
	isMusicGridAvailable,
	planMusicGridEdit,
	queryMusicGrid,
	musicGridNativeFunction,
} from "@opencut/editor-classic/editing";
import { record, onlyKeys } from "./motion-text-request";

export function musicGridCapability() {
	return {
		version: 1,
		status: isMusicGridAvailable() ? "available" : "unavailable",
		reason: isMusicGridAvailable()
			? undefined
			: "Native music-grid WASM ABI is unavailable",
		clocks: ["scene-timeline-ticks", "project-timeline-ticks"],
		projectClockRestriction:
			"Main scene only; unsupported sequence/offset explicitly unavailable",
		routes: {
			bindings: "music-grid/bindings",
			query: "music-grid/query",
			plan: "music-grid/plan",
			edit: "music-grid/edit",
		},
		queryKinds: ["read", "list", "snap", "validate", "project-anchors"],
		queryReadOnly: true,
		writesRequire: ["expectedNativeRevision", "idempotencyKey", "operation"],
		editOperations: [
			"create-measured",
			"create-manual",
			"create-manual-bpm",
			"replace-structure",
			"replace-points",
			"bind",
			"remove",
		],
		returns: ["nativeRevision", "gridRevision", "mappingHash"],
		unknownDownbeatsRemainUnknown: true,
		legacyMotionTextUnchanged: true,
		cutPlanValidation: {
			route: "cut-plan/validate",
			method: "POST",
			readOnly: true,
			status: musicGridNativeFunction("validateCutPlanJson")
				? "available"
				: "unavailable",
		},
	};
}

/** Transport checks only; Rust owns grid validity, source mapping, snapping and CAS planning. */
export function musicGridQueryRequest(input: unknown): MusicGridQuery {
	const value = record(input);
	onlyKeys(value, [
		"kind",
		"bindingId",
		"expectedNativeRevision",
		"expectedGridRevision",
		"expectedMappingHash",
		"pointKind",
		"range",
		"offset",
		"limit",
		"samples",
		"direction",
		"maxDistanceTicks",
		"frameQuantize",
		"clock",
		"anchorSource",
	]);
	if (
		!["read", "list", "snap", "validate", "project-anchors"].includes(
			String(value.kind),
		) ||
		typeof value.bindingId !== "string" ||
		!value.bindingId
	)
		throw Error("Invalid music-grid query kind/bindingId");
	return value as unknown as MusicGridQuery;
}
export function musicGridEditRequest(input: unknown): MusicGridEditRequest {
	const value = record(input);
	onlyKeys(value, ["expectedNativeRevision", "idempotencyKey", "operation"]);
	if (
		!Number.isSafeInteger(value.expectedNativeRevision) ||
		Number(value.expectedNativeRevision) < 0 ||
		typeof value.idempotencyKey !== "string" ||
		!value.idempotencyKey ||
		value.idempotencyKey.length > 500
	)
		throw Error("Music-grid edit requires native revision and idempotency key");
	const operation = record(value.operation);
	if (
		![
			"create-measured",
			"create-manual",
			"create-manual-bpm",
			"replace-structure",
			"replace-points",
			"bind",
			"remove",
		].includes(String(operation.kind))
	)
		throw Error("Invalid music-grid edit operation");
	return value as unknown as MusicGridEditRequest;
}

export async function invokeMusicGrid({
	action,
	input,
	automation,
	sourceAvailability,
}: {
	action: string;
	input?: unknown;
	automation: AutomationApi;
	sourceAvailability?: MusicGridSourceAvailabilityProbe;
}) {
	if (action === "capabilities") return musicGridCapability();
	if (!isMusicGridAvailable())
		return {
			status: "unavailable",
			reason: "Native music-grid WASM ABI is unavailable",
		};
	if (action === "bindings") {
		const before = await automation.revision();
		const project = await automation.project();
		const after = await automation.revision();
		if (before !== after)
			return {
				status: "conflict",
				reason: "Music-grid live project changed while reading bindings",
			};
		return {
			status: "ready",
			live: true,
			nativeRevision: after,
			bindings: project?.musicGridState?.bindings ?? [],
			grids:
				project?.musicGridState?.grids.map(
					({ id, revision, mode, reviewReference }) => ({
						id,
						revision,
						mode,
						reviewReference,
					}),
				) ?? [],
		};
	}
	if (action === "query")
		return queryMusicGrid({
			engine: automation,
			request: musicGridQueryRequest(input),
			sourceAvailability,
		});
	if (action === "plan")
		return planMusicGridEdit({
			engine: automation,
			request: musicGridEditRequest(input),
			sourceAvailability,
		});
	if (action === "edit")
		return editMusicGrid({
			engine: automation,
			request: musicGridEditRequest(input),
			sourceAvailability,
		});
	throw Error("Unknown music-grid action");
}

import type {
	MusicGridEditRequest,
	MusicGridQuery,
	MusicGridSourceAvailabilityProbe,
	TransactionBatch,
	TransactionRead,
	TransactionApply,
} from "@opencut/editor-contracts";
import type {
	TransactionEngineDocument,
	TransactionEngineIssue,
} from "@opencut/editor-contracts/engine";
import * as native from "opencut-wasm";
import { parseEditingIssues } from "./scene-policy";

export {
	capture as captureMusicGridDocument,
	verifySources as verifyMusicGridSources,
	nativeFunction as musicGridNativeFunction,
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function nativeFunction(name: string): ((input: string) => string) | undefined {
	const candidate: unknown = Reflect.get(native, name);
	if (typeof candidate !== "function") return undefined;
	return (input: string) => {
		const value: unknown = candidate(input);
		if (typeof value !== "string")
			throw Error("Invalid native music grid response");
		return value;
	};
}
export function isMusicGridAvailable(): boolean {
	return [
		"queryMusicGridJson",
		"planMusicGridEditJson",
		"validateMusicGridStateJson",
	].every((name) => !!nativeFunction(name));
}
export function validateMusicGridState({
	document,
}: {
	document: TransactionEngineDocument;
}): TransactionEngineIssue[] {
	if (document.project?.musicGridState === undefined) return [];
	const validate = nativeFunction("validateMusicGridStateJson");
	if (!validate)
		return [
			{
				code: "provider:music-grid",
				message: "Native music grid validation is unavailable",
			},
		];
	return parseEditingIssues(
		validate(JSON.stringify(document.project.musicGridState)),
	).map((issue) => ({
		code: "provider:music-grid",
		message: `${issue.path}: ${issue.message}`,
	}));
}
async function capture(engine: TransactionRead) {
	const before = await engine.revision();
	const [project, tracks, clips, assets] = await Promise.all([
		engine.project(),
		engine.tracks(),
		engine.clips(),
		engine.assets(),
	]);
	const after = await engine.revision();
	if (before !== after)
		throw Error("Music grid live snapshot revision conflict");
	if (!project) throw Error("Music grid live project is unavailable");
	return { revision: after, project, tracks, clips, assets };
}
async function verifySources({
	engine,
	result,
	sourceAvailability,
}: {
	engine: TransactionRead;
	result: Record<string, unknown>;
	sourceAvailability?: MusicGridSourceAvailabilityProbe;
}): Promise<Record<string, unknown>> {
	if (result.status !== "ready" && result.status !== "admitted") return result;
	if (!Array.isArray(result.requiredSources))
		throw Error("Missing native music grid source requirements");
	if (result.requiredSources.length && !sourceAvailability)
		return {
			status: "unavailable",
			reason: "music-grid-source-availability-unverified",
		};
	for (const pin of result.requiredSources) {
		if (
			!isRecord(pin) ||
			typeof pin.assetId !== "string" ||
			typeof pin.sourceSha256 !== "string"
		)
			throw Error("Invalid native music grid source requirement");
		const availability = await sourceAvailability?.({
			assetId: pin.assetId,
			sourceSha256: pin.sourceSha256,
		}).catch(() => "unknown");
		if (availability !== "available")
			return {
				status: "unavailable",
				reason:
					availability === "unavailable"
						? "music-grid-source-offline"
						: "music-grid-source-availability-unverified",
			};
	}
	const expected =
		result.status === "ready"
			? result.nativeRevision
			: isRecord(result.batch)
				? result.batch.expectedRevision
				: undefined;
	if (typeof expected !== "number")
		throw Error("Missing native music grid revision");
	if ((await engine.revision()) !== expected)
		return {
			status: "conflict",
			reason: "music-grid-native-revision-conflict",
		};
	return result;
}
/** Always captures the active transaction owner; no caller projection or cache is accepted. */
export async function queryMusicGrid({
	engine,
	request,
	sourceAvailability,
}: {
	engine: TransactionRead;
	request: MusicGridQuery;
	sourceAvailability?: MusicGridSourceAvailabilityProbe;
}): Promise<Record<string, unknown>> {
	const query = nativeFunction("queryMusicGridJson");
	if (!query)
		return {
			status: "unavailable",
			reason: "Native music grid query is unavailable",
		};
	const result: unknown = JSON.parse(
		query(JSON.stringify({ document: await capture(engine), request })),
	);
	if (!isRecord(result)) throw Error("Invalid native music grid query");
	return verifySources({ engine, result, sourceAvailability });
}
/** Prepare a Rust-validated CAS batch. Application still uses the normal transaction owner. */
export async function planMusicGridEdit({
	engine,
	request,
	sourceAvailability,
}: {
	engine: TransactionRead;
	request: MusicGridEditRequest;
	sourceAvailability?: MusicGridSourceAvailabilityProbe;
}): Promise<Record<string, unknown>> {
	const plan = nativeFunction("planMusicGridEditJson");
	if (!plan)
		return {
			status: "unavailable",
			reason: "Native music grid editing is unavailable",
		};
	const result: unknown = JSON.parse(
		plan(JSON.stringify({ document: await capture(engine), request })),
	);
	if (!isRecord(result)) throw Error("Invalid native music grid edit plan");
	return verifySources({ engine, result, sourceAvailability });
}
export async function editMusicGrid({
	engine,
	request,
	sourceAvailability,
}: {
	engine: TransactionRead & TransactionApply;
	request: MusicGridEditRequest;
	sourceAvailability?: MusicGridSourceAvailabilityProbe;
}): Promise<Record<string, unknown>> {
	const plan = await planMusicGridEdit({ engine, request, sourceAvailability });
	if (plan.status !== "admitted") return plan;
	if (!plan.batch || typeof plan.batch !== "object")
		throw Error("Missing native music grid transaction");
	// Rust emits the operation union; the transaction owner independently validates and durably publishes it.
	// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Native planner owns the typed batch; engine.apply independently validates the operation union.
	const receipt = await engine.apply(plan.batch as TransactionBatch);
	return { status: "applied", created: plan.created, receipt };
}

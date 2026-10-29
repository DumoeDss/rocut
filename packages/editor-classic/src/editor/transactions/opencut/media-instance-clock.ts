import type {
	MusicGridSourceAvailabilityProbe,
	TransactionRead,
} from "@opencut/editor-contracts";
import {
	captureMusicGridDocument,
	musicGridNativeFunction,
	verifyMusicGridSources,
} from "./music-grid";
function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
/** Transport only: the selected clip's native Rust source clock remains authoritative. */
export async function queryMediaInstanceClock({
	engine,
	request,
	sourceAvailability,
}: {
	engine: TransactionRead;
	request: unknown;
	sourceAvailability?: MusicGridSourceAvailabilityProbe;
}): Promise<Record<string, unknown>> {
	const query = musicGridNativeFunction("queryMediaInstanceClockJson");
	if (!query)
		return {
			status: "unavailable",
			reason: "Native media-instance clock ABI is unavailable",
		};
	const result: unknown = JSON.parse(
		query(
			JSON.stringify({
				document: await captureMusicGridDocument(engine),
				request,
			}),
		),
	);
	if (!isRecord(result))
		throw Error("Invalid Native media-instance clock response");
	return verifyMusicGridSources({ engine, result, sourceAvailability });
}

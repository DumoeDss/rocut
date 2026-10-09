import type { ProgrammaticSource } from "@opencut/editor-contracts";
import { resolveProgrammaticFrame, type ProgrammaticFrame } from "./frame";

/** A caller's cached plan and allocation limits are not native provenance.
 * Re-enter Rust from authored parameters and the original source sample before
 * resource completion; retain only the caller's timeline location and facts.
 * This is not a permission to execute author code in a document realm.
 */
export function canonicalMvResourceRequest(
	source: ProgrammaticSource,
	frame: ProgrammaticFrame,
): ProgrammaticFrame {
	const canonical = resolveProgrammaticFrame({
		source,
		clipStart: 0,
		clipDuration: 1,
		trimStart: frame.sampleTime ?? frame.sourceTime,
		timelineTime: 0,
	});
	if (!canonical || canonical.index !== frame.index)
		throw Error("Invalid native recipe source sample or frame index");
	return {
		...canonical,
		timelineTime: frame.timelineTime,
		...(frame.fontMetrics ? { fontMetrics: frame.fontMetrics } : {}),
		...(frame.imageDimensions
			? { imageDimensions: frame.imageDimensions }
			: {}),
	};
}

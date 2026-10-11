import { admitAnimationsChannel } from "./scalar-admission";
import { resolveAnimationTarget } from "../timeline/animation-targets";
import type { TimelineElement } from "../timeline";

export interface ProjectAnimationAdmissionIssue {
	readonly elementId: string;
	readonly propertyPath: string;
	readonly reason: string;
}

/**
 * Check every scalar channel of every element against its declared bounds.
 *
 * Returns only provable violations; admitted and unresolved channels are not
 * issues, mirroring the authoring-command admission semantics. Channels whose
 * parameter declares no numeric range are skipped without a core round-trip.
 */
export function collectProjectAnimationAdmissionIssues({
	elements,
}: {
	readonly elements: readonly TimelineElement[];
}): ProjectAnimationAdmissionIssue[] {
	const issues: ProjectAnimationAdmissionIssue[] = [];
	for (const element of elements) {
		const animations = element.animations;
		if (!animations) continue;
		for (const propertyPath of Object.keys(animations)) {
			const target = resolveAnimationTarget({ element, path: propertyPath });
			if (!target) continue;
			const spec = target.numericRanges?.[
				target.channelLayout.kind === "leaf"
					? "value"
					: Object.keys(target.numericRanges)[0]
			];
			if (!spec) continue;
			const admission = admitAnimationsChannel({
				animations,
				propertyPath,
				fallbackValue: Number(target.getBaseValue() ?? 0),
				duration: element.duration,
				spec,
			});
			if (admission.kind === "rejected") {
				issues.push({
					elementId: element.id,
					propertyPath,
					reason: admission.reason,
				});
			}
		}
	}
	return issues;
}

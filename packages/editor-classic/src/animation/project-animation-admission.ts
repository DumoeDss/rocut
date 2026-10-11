import { admitAnimationTargetChannels } from "./scalar-admission";
import { resolveAnimationTarget } from "../timeline/animation-targets";
import type { TimelineElement } from "../timeline";

export interface ProjectAnimationAdmissionIssue {
	readonly kind: "rejected" | "unresolved";
	readonly elementId: string;
	readonly propertyPath: string;
	readonly componentKey?: string;
	readonly reason: string;
}

/**
 * Check every scalar channel of every element against its declared bounds.
 *
 * Returns diagnostics without changing stored channels. Proven violations and
 * unresolved inspection remain distinct, so a legacy or unsupported channel
 * cannot prevent reopening the project or be reported as proven safe. Channels whose
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
			try {
				const target = resolveAnimationTarget({ element, path: propertyPath });
				if (!target) continue;
				const admissions = admitAnimationTargetChannels({
					animations,
					propertyPath,
					duration: element.duration,
					target,
				});
				for (const admission of admissions)
					if (admission.kind !== "admitted") {
						issues.push({
							kind: admission.kind,
							elementId: element.id,
							propertyPath,
							...(target.channelLayout.kind === "composite"
								? { componentKey: admission.componentKey }
								: {}),
							reason: admission.reason,
						});
					}
			} catch (error) {
				issues.push({
					kind: "unresolved",
					elementId: element.id,
					propertyPath,
					reason:
						error instanceof Error
							? error.message
							: "Animation inspection failed.",
				});
			}
		}
	}
	return issues;
}

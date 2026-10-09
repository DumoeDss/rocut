import { inspectRemotionProject } from "./remotion-inspection-project";
import {
	selectInspectedComposition,
	assertInspectionMetadataUnchanged,
} from "./remotion-inspection-snapshot";
import type { RemotionInspectionSnapshot } from "./remotion-inspection-types";
import { compileProgrammaticProject } from "./engines/compile-project";

/** One host-owned immutable snapshot. No project attachments or timeline writes
 * occur during discovery; failures/cancellation invalidate the previous receipt. */
export function createRemotionInspectionSession(
	options: {
		toolchainDirectory: string;
		executable: string;
		context: Parameters<typeof compileProgrammaticProject>[0]["context"];
		enqueue: Parameters<typeof compileProgrammaticProject>[0]["enqueue"];
	},
	inspect = inspectRemotionProject,
	compile = compileProgrammaticProject,
) {
	let snapshot: RemotionInspectionSnapshot | undefined;
	let generation = 0;
	return {
		clear() {
			generation++;
			snapshot = undefined;
		},
		async perform(
			action: "inspect" | "compile-inspected",
			input: unknown,
			signal: AbortSignal,
		) {
			const previous = snapshot,
				epoch = ++generation;
			snapshot = undefined;
			try {
				if (action === "inspect") {
					const next = await inspect({ ...options, input, signal });
					signal.throwIfAborted();
					if (epoch !== generation) throw Error("Inspection superseded");
					snapshot = next;
					return {
						version: 1,
						revision: next.revision,
						inputs: next.inputs.map((i) => i.resource),
						toolchainLockSha256: next.toolchainLockSha256,
						inputProps: next.source.build!.inputProps ?? {},
						compositions: next.compositions,
						scope: "host-session-single-snapshot; no-project-mutation",
					};
				}
				const prepared = selectInspectedComposition(previous, input);
				const current = await inspect({
					...options,
					input: undefined,
					prepared: previous,
					signal,
				});
				assertInspectionMetadataUnchanged(
					previous!,
					current,
					prepared.source.build!.compositionId!,
				);
				signal.throwIfAborted();
				if (epoch !== generation) throw Error("Inspection superseded");
				const result = await compile({
					...options,
					action: "compile",
					input: undefined,
					prepared,
					signal,
				});
				signal.throwIfAborted();
				if (epoch !== generation) throw Error("Inspection superseded");
				return {
					...result,
					inspectionRevision: previous!.revision,
					metadataStability:
						"rechecked-before-compile; runtime-geometry-checked; runtime-props-not-pinned",
				};
			} catch (error) {
				if (epoch === generation) snapshot = undefined;
				throw error;
			}
		},
	};
}

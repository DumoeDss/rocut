import type { TransactionEngineDocument } from "@opencut/editor-contracts/engine";
import type { TransitionGraphError, TransitionPlanError } from "opencut-wasm";
import { evaluateDocumentTransitions } from "../editor/transactions/opencut/media-policy";

const planMessages: Record<TransitionPlanError, string> = {
	"invalid-frame-rate":
		"The project frame rate cannot support this transition.",
	"invalid-duration": "Enter a whole number of at least 2 frames.",
	"invalid-clip": "A clip has invalid timing. Check its timeline range.",
	"different-tracks": "Choose clips on the same video track.",
	"same-clip": "Choose a different outgoing clip.",
	"not-adjacent": "The outgoing clip must end exactly where this clip starts.",
	"unaligned-cut":
		"Align the cut to a project frame before adding a transition.",
	"insufficient-clip-duration":
		"This transition is longer than the clips allow. Reduce its duration.",
	"invalid-source":
		"Source timing is unavailable or invalid. Check the imported media.",
	"missing-outgoing-handle":
		"The outgoing video needs more footage after its cut. Shorten the transition or trim its end.",
	"missing-incoming-handle":
		"This video needs more footage before its cut. Shorten the transition or trim its start.",
};

function explainTransitionError({
	error,
}: {
	error: TransitionGraphError;
}): string {
	if (error.code === "invalid-plan") return planMessages[error.reason];
	switch (error.code) {
		case "missing-clip":
			return "A transition clip or its source media is unavailable.";
		case "ambiguous-clip":
			return "Duplicate clip IDs prevent this transition from being saved.";
		case "duplicate-incoming":
		case "duplicate-outgoing":
			return "A clip is already connected at this side of the cut.";
		case "overlapping-windows":
			return "This transition overlaps another transition. Reduce its duration.";
	}
}

/** UI preflight over the same Rust graph used at commit; never mutates the document. */
export function inspectTransitionChoice({
	document,
	incomingId,
	outgoingId,
	durationFrames,
}: {
	document: TransactionEngineDocument;
	incomingId: string;
	outgoingId: string;
	durationFrames: number;
}): { valid: boolean; message: string } {
	if (!outgoingId)
		return {
			valid: false,
			message: "Choose an outgoing clip from this track.",
		};
	const outgoing = document.clips.find((clip) => clip.id === outgoingId);
	const incoming = document.clips.find((clip) => clip.id === incomingId);
	if (!outgoing || !incoming)
		return {
			valid: false,
			message: "The selected clip is no longer available.",
		};
	// Transport validation only. Rust owns duration limits, adjacency, handles and overlaps.
	if (
		!Number.isInteger(durationFrames) ||
		durationFrames < 0 ||
		durationFrames > 0xffff_ffff
	)
		return { valid: false, message: planMessages["invalid-duration"] };
	try {
		const result = evaluateDocumentTransitions({
			document: {
				...document,
				clips: document.clips.map((clip) =>
					clip.id === incomingId
						? {
								...clip,
								transitionIn: {
									kind: "cross-dissolve",
									outgoingClipId: outgoing.id,
									durationFrames,
								},
							}
						: clip,
				),
			},
		});
		const rejection = result.rejected[0];
		return rejection
			? {
					valid: false,
					message: explainTransitionError({ error: rejection.error }),
				}
			: { valid: true, message: "Clips stay in place. Audio is unchanged." };
	} catch {
		return {
			valid: false,
			message:
				"Could not validate this transition. Check the project and source media.",
		};
	}
}

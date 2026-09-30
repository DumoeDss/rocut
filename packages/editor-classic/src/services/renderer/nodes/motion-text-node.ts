import type { MotionTextSequence } from "@opencut/editor-contracts";
import { mapMotionTextClipTime } from "opencut-wasm";

import type {
	MotionTextRenderDiagnostic,
	MotionTextRenderFrame,
	MotionTextRenderRuntime,
} from "../motion-text/jizura-adapter";
import { createMotionTextRenderRuntime } from "../motion-text/jizura-adapter";
import type {
	MotionTextFontRuntime,
	MotionTextRenderPurpose,
} from "../motion-text/font-runtime";
import {
	VisualNode,
	type ResolvedVisualNodeState,
	type VisualNodeParams,
} from "./visual-node";

export interface MotionTextNodeParams extends VisualNodeParams {
	readonly elementId: string;
	readonly sequence: MotionTextSequence;
	readonly timeMapper?: MotionTextTimeMapper;
	readonly fontRuntime?: MotionTextFontRuntime;
	readonly projectId?: string;
	readonly renderPurpose?: MotionTextRenderPurpose;
}

export type MotionTextTimeMapper = (options: {
	readonly clipStartTime: number;
	readonly clipDuration: number;
	readonly trimStart: number;
	readonly timelineTime: number;
	readonly sequenceDuration: number;
}) => { readonly active: boolean; readonly sequenceTime?: number | null };

export interface ResolvedMotionTextNodeState extends ResolvedVisualNodeState {
	readonly frame: MotionTextRenderFrame;
	readonly contentHash: string;
}

export class MotionTextRenderResourceError extends Error {
	readonly diagnostics: readonly MotionTextRenderDiagnostic[];

	constructor(diagnostics: readonly MotionTextRenderDiagnostic[]) {
		super(
			`Motion-text export resources are not ready: ${diagnostics.map(({ message }) => message).join("; ")}`,
		);
		this.name = "MotionTextRenderResourceError";
		this.diagnostics = diagnostics;
	}
}

export class MotionTextNode extends VisualNode<
	MotionTextNodeParams,
	ResolvedMotionTextNodeState
> {
	readonly runtime: MotionTextRenderRuntime;
	readonly mapClipTime: MotionTextTimeMapper;
	diagnostics: readonly MotionTextRenderDiagnostic[] = [];
	private preparedRuntime: Promise<MotionTextRenderRuntime> | null = null;
	private preparedGeneration: number | null = null;

	constructor(params: MotionTextNodeParams) {
		super(params);
		this.runtime = createMotionTextRenderRuntime({ sequence: params.sequence });
		this.mapClipTime = params.timeMapper ?? mapMotionTextClipTime;
		this.diagnostics = this.runtime.baseDiagnostics;
	}

	async getRenderRuntime(): Promise<MotionTextRenderRuntime> {
		const { fontRuntime, projectId, sequence } = this.params;
		const renderPurpose = this.params.renderPurpose ?? "preview";
		if (!fontRuntime || !projectId) {
			if (!referencesExplicitFont(sequence)) return this.runtime;
			const diagnostic: MotionTextRenderDiagnostic = {
				severity: renderPurpose === "export" ? "error" : "warning",
				code: "font-runtime-unavailable",
				message:
					"Motion-text references an explicit font, but no project font runtime is available.",
			};
			const runtime = createMotionTextRenderRuntime({
				sequence,
				resourceDiagnostics: [diagnostic],
				resourceFingerprint: "font-runtime-unavailable",
			});
			this.diagnostics = runtime.baseDiagnostics;
			return runtime;
		}

		const generation = fontRuntime.inspect().generation;
		if (this.preparedRuntime && this.preparedGeneration === generation) {
			return this.preparedRuntime;
		}
		this.preparedRuntime = null;
		this.preparedGeneration = null;
		const pending = fontRuntime
			.prepareSequence({ projectId, purpose: renderPurpose, sequence })
			.then((prepared) => {
				if (
					prepared.generation !== generation ||
					fontRuntime.inspect().generation !== generation
				) {
					throw new Error(
						"Motion-text font preparation became stale before publication.",
					);
				}
				const runtime = createMotionTextRenderRuntime({
					sequence,
					resolvedFonts: prepared.fonts,
					resourceDiagnostics: prepared.diagnostics,
					resourceFingerprint: prepared.fingerprint,
				});
				this.diagnostics = runtime.baseDiagnostics;
				return runtime;
			})
			.catch((error: unknown) => {
				if (this.preparedRuntime === pending) {
					this.preparedRuntime = null;
					this.preparedGeneration = null;
				}
				throw error;
			});
		this.preparedRuntime = pending;
		this.preparedGeneration = generation;
		return pending;
	}
}

function referencesExplicitFont(sequence: MotionTextSequence): boolean {
	return (
		sequence.defaults.fontId !== undefined ||
		(sequence.resolvedPlan?.cuts.some((cut) => cut.fontId !== undefined) ??
			false)
	);
}

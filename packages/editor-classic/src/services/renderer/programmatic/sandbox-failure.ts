import type { ProgrammaticSource } from "@opencut/editor-contracts";
import type { ProgrammaticFrame } from "./frame";

export type ProgrammaticSandboxOperation =
	"render" | "measure-fonts" | "measure-resources" | "measure-tunnel-fonts";

export type ProgrammaticSandboxPhase =
	"iframe-load" | "sandbox-ready" | "worker-start" | "worker-result";

export const SANDBOX_WORKER_STAGES = [
	"worker-started",
	"worker-font-resources",
	"worker-font-measure",
	"worker-tunnel-fonts",
	"worker-image-decode",
	"worker-sequence-decode",
	"worker-render",
	"worker-bitmap-transfer",
] as const;
export type SandboxWorkerStage = (typeof SANDBOX_WORKER_STAGES)[number];
export interface SandboxStageEvent {
	readonly phase: ProgrammaticSandboxPhase;
	readonly elapsedMs: number;
	readonly workerStage?: SandboxWorkerStage;
	readonly workerElapsedMs?: number;
}

/** Scalar diagnostics only: never include author code, asset bytes or paths. */
export function sandboxFailure({
	message,
	operation,
	phase,
	source,
	frame,
	diagnostics,
}: {
	message: string;
	operation: ProgrammaticSandboxOperation;
	phase: ProgrammaticSandboxPhase;
	source: ProgrammaticSource;
	frame: ProgrammaticFrame;
	diagnostics?: Pick<
		SandboxStageEvent,
		"elapsedMs" | "workerStage" | "workerElapsedMs"
	>;
}): Error {
	const context = {
		operation,
		phase,
		root: source.recipe?.root.slice(0, 96) ?? "authored-code",
		seed: source.seed,
		frameIndex: frame.index,
		sourceTime: frame.sourceTime,
		timelineTime: frame.timelineTime,
		width: source.width,
		height: source.height,
		...diagnostics,
	};
	return Object.assign(
		new Error(`${message} [sandbox ${JSON.stringify(context)}]`),
		{ name: "ProgrammaticSandboxError", context: Object.freeze(context) },
	);
}

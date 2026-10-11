import type { ProgrammaticSource } from "@opencut/editor-contracts";
import type { ProgrammaticFrame } from "./frame";

export type ProgrammaticSandboxOperation =
	| "render"
	| "measure-fonts"
	| "measure-resources"
	| "measure-tunnel-fonts";

export type ProgrammaticSandboxPhase =
	| "iframe-load"
	| "sandbox-ready"
	| "worker-start"
	| "worker-result";

/** Scalar diagnostics only: never include author code, asset bytes or paths. */
export function sandboxFailure({
	message,
	operation,
	phase,
	source,
	frame,
}: {
	message: string;
	operation: ProgrammaticSandboxOperation;
	phase: ProgrammaticSandboxPhase;
	source: ProgrammaticSource;
	frame: ProgrammaticFrame;
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
	};
	return Object.assign(
		new Error(`${message} [sandbox ${JSON.stringify(context)}]`),
		{ name: "ProgrammaticSandboxError", context: Object.freeze(context) },
	);
}

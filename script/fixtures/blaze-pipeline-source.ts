import { blazeSource, type BlazeSourceKind } from "./blaze-cases";
export type PipelineSourceKind = BlazeSourceKind;
export const pipelineSource = (
	width: number,
	height: number,
	kind: PipelineSourceKind,
) => blazeSource({ width, height, kind, pattern: "gradient" });

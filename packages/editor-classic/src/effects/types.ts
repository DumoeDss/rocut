import type { ParamDefinition, ParamValues } from "../params";
import type { FrameRate } from "opencut-wasm";

export interface EffectFrameContext {
	/** Signed clip-local integer ticks, independent of source trim/playback rate. */
	localTime: number;
	frameRate: FrameRate;
}

export interface EffectRenderInput {
	effectParams: ParamValues;
	width: number;
	height: number;
	/** Required by time-dependent effects; static thumbnails supply frame zero. */
	frame?: EffectFrameContext;
}

export interface Effect {
	id: string;
	type: string;
	params: ParamValues;
	enabled: boolean;
}

export type EffectUniformValue = number | number[];

export interface EffectPass {
	shader: string;
	uniforms: Record<string, EffectUniformValue>;
}

export interface EffectPassTemplate {
	shader: string;
	uniforms(params: EffectRenderInput): Record<string, EffectUniformValue>;
}

export interface EffectRendererConfig {
	passes: EffectPassTemplate[];
	buildPasses?: (params: EffectRenderInput) => EffectPass[];
}

export interface EffectDefinition {
	type: string;
	name: string;
	keywords: string[];
	params: ParamDefinition[];
	renderer: EffectRendererConfig;
}

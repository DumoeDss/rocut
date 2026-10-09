import type { ParamDefinition, ParamValues } from "../params";

export const DEFAULT_GRAPHIC_SOURCE_SIZE = 512;

export interface GraphicRenderContext {
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	params: ParamValues;
	width: number;
	height: number;
}

export interface GraphicDefinition {
	id: string;
	/** Exclude source-backed definitions from the one-click static shape palette. */
	requiresSource?: boolean;
	name: string;
	keywords: string[];
	params: ParamDefinition[];
	render(context: GraphicRenderContext): void;
}

export interface GraphicInstance {
	definitionId: string;
	params: ParamValues;
}

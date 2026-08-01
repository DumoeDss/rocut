import { resolveGraphicParamsAtTime } from "@/animation";
import type { ElementAnimations } from "@/animation/types";
import { buildDefaultParamValues } from "@/params/registry";
import type { ParamValues } from "@/params";
import { graphicsRegistry } from "./registry";
import {
	registerDefaultGraphics,
	ellipseGraphicDefinition,
	polygonGraphicDefinition,
	rectangleGraphicDefinition,
	starGraphicDefinition,
} from "./definitions";
import {
	DEFAULT_GRAPHIC_SOURCE_SIZE,
	type GraphicInstance,
	type GraphicDefinition,
} from "./types";
import { buildGeneratedGraphicPreviewUrl } from "./generated-preview";

const graphicPreviewUrlCache = new Map<string, string>();

function buildFallbackPreviewUrl({
	name,
	size,
}: {
	name: string;
	size: number;
}): string {
	return buildGeneratedGraphicPreviewUrl({ name, size });
}

export function getGraphicDefinition({
	definitionId,
}: {
	definitionId: string;
}): GraphicDefinition {
	registerDefaultGraphics();
	return graphicsRegistry.get(definitionId);
}

export function buildDefaultGraphicInstance({
	definitionId,
}: {
	definitionId: string;
}): GraphicInstance {
	const definition = getGraphicDefinition({ definitionId });
	return {
		definitionId,
		params: buildDefaultParamValues(definition.params),
	};
}

export function resolveGraphicParams({
	definition,
	params,
}: {
	definition: GraphicDefinition;
	params?: ParamValues;
}): ParamValues {
	return {
		...buildDefaultParamValues(definition.params),
		...(params ?? {}),
	};
}

export function resolveGraphicElementParamsAtTime({
	element,
	localTime,
}: {
	element: {
		definitionId: string;
		params: ParamValues;
		animations?: ElementAnimations;
	};
	localTime: number;
}): ParamValues {
	const definition = getGraphicDefinition({
		definitionId: element.definitionId,
	});
	return resolveGraphicParamsAtTime({
		params: resolveGraphicParams({
			definition,
			params: element.params,
		}),
		definitions: definition.params,
		animations: element.animations,
		localTime,
	});
}

export function buildGraphicPreviewUrl({
	definitionId,
	params,
	size = DEFAULT_GRAPHIC_SOURCE_SIZE,
}: {
	definitionId: string;
	params?: ParamValues;
	size?: number;
}): string {
	const definition = getGraphicDefinition({ definitionId });
	const resolvedParams = resolveGraphicParams({ definition, params });
	const cacheKey = JSON.stringify({ definitionId, resolvedParams, size });
	const cachedUrl = graphicPreviewUrlCache.get(cacheKey);
	if (cachedUrl) {
		return cachedUrl;
	}

	if (typeof document === "undefined") {
		return buildFallbackPreviewUrl({ name: definition.name, size });
	}

	const canvas = document.createElement("canvas");
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		return buildFallbackPreviewUrl({ name: definition.name, size });
	}

	definition.render({
		ctx,
		params: resolvedParams,
		width: size,
		height: size,
	});

	const previewUrl = canvas.toDataURL("image/png");
	graphicPreviewUrlCache.set(cacheKey, previewUrl);
	return previewUrl;
}

export {
	DEFAULT_GRAPHIC_SOURCE_SIZE,
	ellipseGraphicDefinition,
	graphicsRegistry,
	polygonGraphicDefinition,
	rectangleGraphicDefinition,
	registerDefaultGraphics,
	starGraphicDefinition,
};
export type {
	GraphicDefinition,
	GraphicInstance,
	GraphicRenderContext,
} from "./types";

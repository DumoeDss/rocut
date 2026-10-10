import * as wasm from "opencut-wasm";
import type { ElementAnimations } from "../animation/types";
import type { ParamValue, ParamValues } from "../params";

export interface EffectLayerAnimationRequest {
	effectType: string;
	params: ParamValues;
	animations: ElementAnimations;
	localTicks: number;
}

export type EffectLayerAnimationCore = (request: string) => string;

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Transport only: catalog admission, legacy DTO conversion and sampling live in Rust. */
export function resolveEffectLayerParams({
	request,
	core,
}: {
	request: EffectLayerAnimationRequest;
	core?: EffectLayerAnimationCore;
}): ParamValues {
	const candidate: unknown =
		core ?? Reflect.get(wasm, "resolveEffectLayerParamsJson");
	if (typeof candidate !== "function") {
		throw new Error(
			"The installed opencut-wasm binary does not expose resolveEffectLayerParamsJson.",
		);
	}
	const response: unknown = JSON.parse(
		candidate(JSON.stringify({ version: 1, ...request })),
	);
	if (!isRecord(response) || response.version !== 1) {
		throw new TypeError("Effect-layer animation returned an invalid response.");
	}
	if ("error" in response) {
		if (
			!isRecord(response.error) ||
			typeof response.error.path !== "string" ||
			typeof response.error.message !== "string"
		) {
			throw new TypeError("Effect-layer animation returned an invalid error.");
		}
		throw new Error(`${response.error.path}: ${response.error.message}`);
	}
	if (!isParamValues(response.params)) {
		throw new TypeError("Effect-layer animation returned invalid params.");
	}
	return response.params;
}

function isParamValues(value: unknown): value is ParamValues {
	return (
		isRecord(value) &&
		Object.values(value).every(
			(param): param is ParamValue =>
				typeof param === "string" ||
				typeof param === "boolean" ||
				(typeof param === "number" && Number.isFinite(param)),
		)
	);
}

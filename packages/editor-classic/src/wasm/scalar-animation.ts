import * as wasm from "opencut-wasm";
import type {
	ChannelExtrapolationMode,
	ScalarAnimationChannel,
	ScalarAnimationKey,
} from "../animation/types";
import type { MediaTime } from "./media-time";

/** Numeric semantics of the Rust scalar evaluator (scalar-f64-v1). */
export const SCALAR_ANIMATION_SEMANTICS = "scalar-f64-v1" as const;

export interface ScalarAnimationSampleItem {
	readonly id: string;
	readonly channel: ScalarAnimationChannel;
	readonly fallbackValue: number;
	readonly times: readonly number[];
}

export type ScalarAnimationSampleCore = (input: string) => string;

export type ScalarAnimationDomainStatus = "safe" | "violation" | "unresolved";

export interface ScalarAnimationDomainReport {
	readonly status: ScalarAnimationDomainStatus;
	readonly domain: { readonly start: number; readonly end: number };
	readonly unprovenDomain?: { readonly start: number; readonly end: number };
	readonly values?: { readonly min: number; readonly max: number };
	readonly displayed?: { readonly min: number; readonly max: number };
	readonly reason?: { readonly code: string; readonly message: string };
}

interface BoundaryError {
	readonly code: string;
	readonly path: string;
	readonly message: string;
	readonly keyIndex?: number;
	readonly sampleIndex?: number;
}

interface BoundaryResponse {
	readonly version?: number;
	readonly numericSemantics?: string;
	readonly results?: ReadonlyArray<Record<string, unknown>>;
	readonly error?: BoundaryError;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function evaluator({
	core: coreOverride,
}: {
	readonly core?: ScalarAnimationSampleCore;
}): ScalarAnimationSampleCore {
	const candidate = coreOverride ?? Reflect.get(wasm, "sampleScalarAnimationBatchJson");
	if (typeof candidate !== "function") {
		throw new Error(
			"The installed opencut-wasm binary does not expose sampleScalarAnimationBatchJson.",
		);
	}
	return candidate;
}

function inspectionEvaluator({
	core: coreOverride,
}: {
	readonly core?: ScalarAnimationSampleCore;
}): ScalarAnimationSampleCore {
	const candidate =
		coreOverride ?? Reflect.get(wasm, "inspectScalarAnimationDomainsJson");
	if (typeof candidate !== "function") {
		throw new Error(
			"The installed opencut-wasm binary does not expose inspectScalarAnimationDomainsJson.",
		);
	}
	return candidate;
}

function wireKey(key: ScalarAnimationKey): Record<string, unknown> {
	const value: Record<string, unknown> = {
		time: key.time,
		value: key.value,
		segmentToNext: key.segmentToNext ?? "linear",
	};
	if (key.leftHandle) {
		value.leftHandle = { dt: key.leftHandle.dt, dv: key.leftHandle.dv };
	}
	if (key.rightHandle) {
		value.rightHandle = { dt: key.rightHandle.dt, dv: key.rightHandle.dv };
	}
	return value;
}

function edgeDefaults(channel: ScalarAnimationChannel): {
	before: ChannelExtrapolationMode;
	after: ChannelExtrapolationMode;
} {
	return channel.extrapolation ?? { before: "hold", after: "hold" };
}

function describeBoundaryError({
	error,
}: {
	readonly error: BoundaryError;
}): string {
	return `${error.path}: ${error.message}`;
}

function parseBoundaryResponse({
	raw,
	context,
}: {
	readonly raw: string;
	readonly context: string;
}): BoundaryResponse {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new TypeError(`${context} returned invalid JSON.`);
	}
	if (!isRecord(parsed)) {
		throw new TypeError(`${context} returned a non-object response.`);
	}
	return parsed;
}

function readError({
	value,
	context,
}: {
	readonly value: unknown;
	readonly context: string;
}): BoundaryError | undefined {
	if (value === undefined) return undefined;
	if (!isRecord(value)) {
		throw new TypeError(`${context} returned an invalid error object.`);
	}
	const { code, path, message } = value;
	if (typeof code !== "string" || typeof path !== "string" || typeof message !== "string") {
		throw new TypeError(`${context} returned an incomplete error object.`);
	}
	return { code, path, message };
}

/** Sample admitted legacy channels through the Rust evaluator, one call per batch. */
export function sampleScalarAnimationBatch({
	items,
	core: coreOverride,
}: {
	readonly items: readonly ScalarAnimationSampleItem[];
	readonly core?: ScalarAnimationSampleCore;
}): number[][] {
	if (items.length === 0) return [];
	const request = {
		version: 1,
		numericSemantics: SCALAR_ANIMATION_SEMANTICS,
		items: items.map(({ id, channel, fallbackValue, times }) => ({
			id,
			channel: {
				keys: channel.keys.map(wireKey),
				extrapolation: edgeDefaults(channel),
			},
			fallbackValue,
			times: [...times],
		})),
	};
	const response = parseBoundaryResponse({
		raw: evaluator({ core: coreOverride })(JSON.stringify(request)),
		context: "Scalar animation sampling",
	});
	if (response.error) {
		throw new RangeError(describeBoundaryError({ error: response.error }));
	}
	if (response.version !== 1 || response.numericSemantics !== SCALAR_ANIMATION_SEMANTICS) {
		throw new TypeError("Scalar animation sampling returned an unsupported response.");
	}
	if (!Array.isArray(response.results) || response.results.length !== items.length) {
		throw new TypeError("Scalar animation sampling returned an invalid batch shape.");
	}
	return response.results.map((result, index) => {
		if (!isRecord(result) || result.id !== items[index].id) {
			throw new TypeError("Scalar animation sampling returned misaligned results.");
		}
		if (result.status !== "values") {
			const error = readError({ value: result.error, context: "Scalar animation sampling" });
			throw new RangeError(
				error
				? describeBoundaryError({ error })
				: `Scalar animation item ${items[index].id} did not produce values.`,
		);
		}
		const values = result.values;
		if (
			!Array.isArray(values) ||
			values.length !== items[index].times.length ||
			!values.every(
				(value): value is number => typeof value === "number" && Number.isFinite(value),
			)
		) {
			throw new TypeError("Scalar animation sampling returned invalid values.");
		}
		return values;
	});
}

function readRange({
	value,
	context,
}: {
	readonly value: unknown;
	readonly context: string;
}): { start: number; end: number } {
	if (!isRecord(value) || typeof value.start !== "number" || typeof value.end !== "number") {
		throw new TypeError(`${context} returned an invalid range.`);
	}
	return { start: value.start, end: value.end };
}

function readOptionalReason({
	value,
	context,
}: {
	readonly value: unknown;
	readonly context: string;
}): { code: string; message: string } | undefined {
	if (value === undefined) return undefined;
	if (!isRecord(value) || typeof value.code !== "string" || typeof value.message !== "string") {
		throw new TypeError(`${context} returned an invalid reason.`);
	}
	return { code: value.code, message: value.message };
}

/** Inspect one channel's bounded-domain admission; never turns Unresolved into Safe or invalid. */
export function inspectScalarAnimationDomain({
	channel,
	fallbackValue,
	domain,
	bounds,
	maxNodes,
	core: coreOverride,
}: {
	readonly channel: ScalarAnimationChannel;
	readonly fallbackValue: number;
	readonly domain: { readonly start: MediaTime; readonly end: MediaTime };
	readonly bounds: {
		readonly min?: number;
		readonly max?: number;
		readonly displayMultiplier: number;
	};
	readonly maxNodes: number;
	readonly core?: ScalarAnimationSampleCore;
}): ScalarAnimationDomainReport {
	if (!Number.isInteger(maxNodes) || maxNodes < 1) {
		throw new RangeError("Inspection node budget must be a positive integer.");
	}
	if (domain.start >= domain.end) {
		throw new RangeError("Inspection domain must be an ordered nonempty range.");
	}
	const request = {
		version: 1,
		numericSemantics: SCALAR_ANIMATION_SEMANTICS,
		items: [
			{
				id: "domain-inspection",
				channel: {
					keys: channel.keys.map(wireKey),
					extrapolation: edgeDefaults(channel),
				},
				fallbackValue,
				domain: { start: domain.start, end: domain.end },
				bounds: {
					...(bounds.min !== undefined ? { min: bounds.min } : {}),
					...(bounds.max !== undefined ? { max: bounds.max } : {}),
					displayMultiplier: bounds.displayMultiplier,
				},
				budget: { maxNodes },
			},
		],
		budget: { maxNodes },
	};
	const response = parseBoundaryResponse({
		raw: inspectionEvaluator({ core: coreOverride })(JSON.stringify(request)),
		context: "Scalar animation domain inspection",
	});
	if (response.error) {
		throw new RangeError(describeBoundaryError({ error: response.error }));
	}
	if (
		response.version !== 1 ||
		response.numericSemantics !== SCALAR_ANIMATION_SEMANTICS ||
		!Array.isArray(response.results) ||
		response.results.length !== 1
	) {
		throw new TypeError("Scalar animation domain inspection returned an invalid response.");
	}
	const result = response.results[0];
	if (!isRecord(result) || result.id !== "domain-inspection") {
		throw new TypeError("Scalar animation domain inspection returned a misaligned result.");
	}
	if (result.status === "values" || result.status === "error") {
		throw new TypeError("Scalar animation domain inspection returned a sample result.");
	}
	const status = result.status;
	if (status !== "safe" && status !== "violation" && status !== "unresolved") {
		throw new TypeError("Scalar animation domain inspection returned an unknown status.");
	}
	const report: ScalarAnimationDomainReport = {
		status,
		domain: readRange({
			value: result.domain,
			context: "Scalar animation domain inspection",
		}),
		...(isRecord(result.values)
			? {
					values: readEnclosure({
						value: result.values,
						context: "Scalar animation domain inspection",
					}),
				}
			: {}),
		...(isRecord(result.displayed)
			? {
					displayed: readEnclosure({
						value: result.displayed,
						context: "Scalar animation domain inspection",
					}),
				}
			: {}),
		...(result.unprovenDomain !== undefined
			? {
					unprovenDomain: readRange({
						value: result.unprovenDomain,
						context: "Scalar animation domain inspection",
					}),
				}
			: {}),
		...(result.reason !== undefined || result.error !== undefined
			? {
					reason: readOptionalReason({
						value: result.reason ?? result.error,
						context: "Scalar animation domain inspection",
					}),
				}
			: {}),
	};
	if ((report.status === "unresolved") !== (report.unprovenDomain !== undefined)) {
		throw new TypeError("Scalar animation domain inspection returned inconsistent status.");
	}
	if (report.status === "safe" && (!report.values || !report.displayed)) {
		throw new TypeError("Scalar animation domain inspection returned Safe without enclosures.");
	}
	if (report.status !== "safe" && (report.values !== undefined || report.displayed !== undefined)) {
		throw new TypeError("Scalar animation domain inspection returned enclosures without Safe.");
	}
	return report;
}

function readEnclosure({
	value,
	context,
}: {
	readonly value: Record<string, unknown>;
	readonly context: string;
}): { min: number; max: number } {
	if (typeof value.min !== "number" || typeof value.max !== "number") {
		throw new TypeError(`${context} returned an invalid enclosure.`);
	}
	return { min: value.min, max: value.max };
}

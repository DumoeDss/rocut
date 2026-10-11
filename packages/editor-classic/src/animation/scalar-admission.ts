import { ZERO_MEDIA_TIME, type MediaTime } from "../wasm";
import type { NumericSpec, ScalarAnimationChannel } from "./types";
import { inspectScalarAnimationDomain } from "../wasm/scalar-animation";
import { isScalarChannelData } from "./scalar-batch-resolver";
import type { AnimationPath, ElementAnimations } from "./types";
import { isCompositeChannelData } from "./channel-data";
import type { AnimationPathDescriptor } from "../timeline/animation-targets";

export type ScalarAdmissionStatus =
	| { readonly kind: "admitted" }
	| { readonly kind: "rejected"; readonly reason: string }
	| { readonly kind: "unresolved"; readonly reason: string };

export interface ScalarAdmissionOptions {
	readonly channel: ScalarAnimationChannel | undefined;
	readonly fallbackValue: number;
	readonly domain: { readonly start: MediaTime; readonly end: MediaTime };
	readonly spec: NumericSpec | undefined;
	readonly maxNodes?: number;
}

/**
 * Admission for a scalar channel with explicit numeric bounds.
 *
 * Only inspects when the parameter declares min/max; parameters without a
 * range are admitted without a WASM round-trip, preserving current behavior.
 * Unresolved is reported as its own state and never collapses to admitted
 * or rejected, so callers cannot treat an unproven domain as safe.
 */
export function admitScalarChannel({
	channel,
	fallbackValue,
	domain,
	spec,
	maxNodes = 65536,
}: ScalarAdmissionOptions): ScalarAdmissionStatus {
	if (spec?.min === undefined && spec?.max === undefined) {
		return { kind: "admitted" };
	}
	if (!channel || channel.keys.length === 0) {
		return { kind: "admitted" };
	}
	if (domain.start >= domain.end) {
		return { kind: "unresolved", reason: "Empty inspection domain." };
	}
	const step = spec?.step;
	const displayMultiplier =
		typeof step === "number" && step > 0 && Number.isFinite(step)
			? 1 / step
			: 1;
	// The core compares the displayed enclosure (value * multiplier) against
	// these bounds, so bounds must live in the same displayed space. Scaling
	// them by the multiplier keeps raw values, displayed values and bounds in
	// one consistent frame instead of comparing a scaled value against an
	// unscaled bound (which rejected every in-range value when step < 1).
	const report = inspectScalarAnimationDomain({
		channel,
		fallbackValue,
		domain,
		bounds: {
			...(spec?.min !== undefined ? { min: spec.min * displayMultiplier } : {}),
			...(spec?.max !== undefined ? { max: spec.max * displayMultiplier } : {}),
			displayMultiplier,
		},
		maxNodes,
	});
	if (report.status === "safe") {
		return { kind: "admitted" };
	}
	if (report.status === "violation") {
		return {
			kind: "rejected",
			reason:
				report.reason?.message ?? "Channel leaves the declared numeric bounds.",
		};
	}
	return {
		kind: "unresolved",
		reason:
			report.reason?.message ??
			"Domain safety could not be proven within the node budget.",
	};
}

/** Admission for a channel inside element animations, keyed by property path. */
export function admitAnimationsChannel({
	animations,
	propertyPath,
	fallbackValue,
	duration,
	spec,
	componentKey = "value",
}: {
	readonly animations: ElementAnimations | undefined;
	readonly propertyPath: AnimationPath;
	readonly fallbackValue: number;
	readonly duration: MediaTime;
	readonly spec: NumericSpec | undefined;
	readonly componentKey?: string;
}): ScalarAdmissionStatus {
	const data = animations?.[propertyPath];
	const channel = isCompositeChannelData(data)
		? data[componentKey]
		: componentKey === "value"
			? data
			: undefined;
	return admitScalarChannel({
		channel: isScalarChannelData(channel) ? channel : undefined,
		fallbackValue,
		domain: { start: ZERO_MEDIA_TIME, end: duration },
		spec,
	});
}

/** Route declared scalar components to the existing Rust domain inspector. */
export function admitAnimationTargetChannels({
	animations,
	propertyPath,
	duration,
	target,
	componentKey,
	leafFallbackValue,
}: {
	readonly animations: ElementAnimations | undefined;
	readonly propertyPath: AnimationPath;
	readonly duration: MediaTime;
	readonly target: Pick<
		AnimationPathDescriptor,
		"channelLayout" | "numericRanges" | "getBaseValue"
	>;
	readonly componentKey?: string;
	readonly leafFallbackValue?: number;
}): Array<ScalarAdmissionStatus & { readonly componentKey: string }> {
	const layout = target.channelLayout;
	const components =
		layout.kind === "leaf" ? [layout.component] : layout.components;
	return components
		.filter(
			(component) =>
				component.valueKind === "scalar" &&
				(componentKey === undefined || component.key === componentKey),
		)
		.map((component) => {
			const spec = target.numericRanges?.[component.key];
			if (spec?.min === undefined && spec?.max === undefined)
				return { componentKey: component.key, kind: "admitted" as const };
			const data = animations?.[propertyPath];
			const channel = isCompositeChannelData(data) ? data[component.key] : data;
			if (!isScalarChannelData(channel) || channel.keys.length === 0)
				return { componentKey: component.key, kind: "admitted" as const };
			const base = target.getBaseValue();
			const decomposed =
				layout.kind === "composite" && typeof base === "string"
					? layout.decompose(base)
					: null;
			const fallbackValue =
				layout.kind === "leaf"
					? (leafFallbackValue ?? Number(base ?? 0))
					: Object.entries(decomposed ?? {}).find(
							([key]) => key === component.key,
						)?.[1];
			if (
				layout.kind === "composite" &&
				(typeof fallbackValue !== "number" || !Number.isFinite(fallbackValue))
			)
				return {
					componentKey: component.key,
					kind: "unresolved" as const,
					reason: "The bounded component base value could not be decomposed.",
				};
			return {
				componentKey: component.key,
				...admitAnimationsChannel({
					animations,
					propertyPath,
					componentKey: component.key,
					fallbackValue: Number(fallbackValue),
					duration,
					spec,
				}),
			};
		});
}

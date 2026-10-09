export const PROJECT_EXPORT_LIMITS: Readonly<{
	meanRgbError: number;
	activeMeanRgbError: number;
	activeChannelThreshold: number;
	activeLumaRatioMinimum: number;
	activeLumaRatioMaximum: number;
	minimumActivePixels: number;
	blankMeanRgbMaximum: number;
	timestampToleranceSeconds: number;
	negativeMinimumActiveMeanRgbError: number;
	opacityCompositeMeanErrorMaximum: number;
	opacityCompositeMaximumError: number;
}>;
export interface ProjectPixelMetrics {
	meanRgbError: number;
	activeMeanRgbError: number;
	activePixels: number;
	activeLumaRatio: number | null;
	actualMeanRgb: number;
}
export function projectPixelMetrics(
	actual: Uint8Array,
	reference: Uint8Array,
	activityReference?: Uint8Array,
): ProjectPixelMetrics;
export function opacityCompositeMetrics(
	saved: Uint8Array,
	fullOpacity: Uint8Array,
): { channels: number; mean: number; maximum: number; accepted: boolean };
export function acceptsProjectPixels(
	metrics: ProjectPixelMetrics,
	active: boolean,
): boolean;

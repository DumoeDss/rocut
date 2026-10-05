import type { FrameRate } from "opencut-wasm";
import { floatToFrameRate, frameRateToFloat } from "./utils";

export const FPS_PRESETS = [
	{ value: "23.976", label: "23.976 fps" },
	{ value: "24", label: "24 fps" },
	{ value: "25", label: "25 fps" },
	{ value: "29.97", label: "29.97 fps" },
	{ value: "30", label: "30 fps" },
	{ value: "59.94", label: "59.94 fps" },
	{ value: "60", label: "60 fps" },
	{ value: "120", label: "120 fps" },
] as const;

/** Display existing rational rates without relabelling them as integers. */
export function frameRateSelectOption(rate: FrameRate): {
	value: string;
	label: string;
} {
	return (
		FPS_PRESETS.find(
			(preset) =>
				frameRateToFloat(floatToFrameRate(Number(preset.value))) ===
				frameRateToFloat(rate),
		) ?? {
			value: "custom",
			label: `${rate.numerator}/${rate.denominator} fps (custom)`,
		}
	);
}

import { colorAdjustmentCatalog, normalizeColorAdjustment } from "../../wasm";
import type { EffectDefinition } from "../types";

export const COLOR_ADJUSTMENT_TYPE = "color-adjustment";

export const colorAdjustmentDefinition: EffectDefinition = {
	type: COLOR_ADJUSTMENT_TYPE,
	name: "Color adjustment",
	keywords: [
		"color",
		"exposure",
		"contrast",
		"saturation",
		"temperature",
		"tint",
	],
	params: colorAdjustmentCatalog().fields.map((field) => ({
		...field,
		type: "number",
		keyframable: false,
	})),
	renderer: {
		passes: [
			{
				shader: COLOR_ADJUSTMENT_TYPE,
				uniforms: ({ effectParams }) => {
					const number = (key: string) =>
						typeof effectParams[key] === "number" ? effectParams[key] : 0;
					return {
						...normalizeColorAdjustment({
							exposure: number("exposure"),
							contrast: number("contrast"),
							saturation: number("saturation"),
							temperature: number("temperature"),
							tint: number("tint"),
						}),
					};
				},
			},
		],
	},
};

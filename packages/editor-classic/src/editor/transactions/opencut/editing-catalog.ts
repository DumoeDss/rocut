import { registerDefaultEffects } from "../../../effects/definitions";
import { effectsRegistry } from "../../../effects/registry";
import { registerDefaultGraphics } from "../../../graphics/definitions";
import { graphicsRegistry } from "../../../graphics/registry";
import { registerDefaultMasks } from "../../../masks/builtin/definitions";
import { masksRegistry } from "../../../masks/registry";
import type { ParamDefinition } from "../../../params";
import { getBuiltInElementParams } from "../../../params/registry";
import type { ElementType } from "../../../timeline/types";
import {
	DEFAULT_TRANSCRIPTION_MODEL,
	TRANSCRIPTION_MODELS,
} from "../../../transcription/models";
import { TRANSCRIPTION_LANGUAGES } from "../../../transcription/supported-languages";

function describeParam(param: ParamDefinition) {
	const description: Record<string, unknown> = {
		key: param.key,
		label: param.label,
		type: param.type,
		default: param.default,
		keyframable: param.keyframable !== false,
		...(param.dependencies && { dependencies: param.dependencies }),
	};
	if (param.type === "number")
		Object.assign(description, {
			min: param.min,
			max: param.max,
			step: param.step,
			displayMultiplier: param.displayMultiplier,
		});
	if (param.type === "select") description.options = param.options;
	return description;
}

/** Derived from the exact registries used by inspectors/rendering, not a second list. */
export function editingCatalog() {
	registerDefaultEffects();
	registerDefaultGraphics();
	registerDefaultMasks();
	const types: ElementType[] = [
		"video",
		"image",
		"audio",
		"text",
		"graphic",
		"sticker",
		"motion-text",
		"effect",
	];
	return {
		version: 1,
		timebase: 120_000,
		transcription: {
			defaultModelId: DEFAULT_TRANSCRIPTION_MODEL,
			models: TRANSCRIPTION_MODELS.map((model) => ({ ...model })),
			languages: TRANSCRIPTION_LANGUAGES.map((language) => ({ ...language })),
			requiresAttachedPane: true,
			requiresModelDownloadConsent: true,
			returns: "caption-plan",
		},
		semantics: {
			editing: "replace",
			params: "replace",
			animations: "replace",
			effects: "ordered-replace",
			masks: "ordered-replace",
			keyTime: "element-relative-ticks",
			volume: "dB",
		},
		elements: Object.fromEntries(
			types.map((type) => [
				type,
				getBuiltInElementParams({ type }).map(describeParam),
			]),
		),
		graphics: Object.fromEntries(
			graphicsRegistry
				.getAll()
				.map((definition) => [
					definition.id,
					definition.params.map(describeParam),
				]),
		),
		effects: Object.fromEntries(
			effectsRegistry
				.getAll()
				.map((definition) => [
					definition.type,
					definition.params.map(describeParam),
				]),
		),
		masks: Object.fromEntries(
			masksRegistry.getAll().map((definition) => {
				const defaults = definition.buildDefault({}).params;
				const params = definition.params
					.filter((param) => param.key !== "path")
					.map(describeParam);
				// Some canvas-only controls (inversion, stroke alignment, closed path)
				// are not inspector sliders, but are still registered default fields.
				for (const [key, value] of Object.entries(defaults)) {
					if (key === "path" || params.some((param) => param.key === key))
						continue;
					params.push(
						key === "strokeAlign"
							? {
									key,
									type: "select",
									default: value,
									options: ["inside", "center", "outside"].map((value) => ({
										value,
										label: value,
									})),
								}
							: {
									key,
									type: typeof value === "string" ? "text" : typeof value,
									default: value,
								},
					);
				}
				return [
					definition.type,
					{ params, defaults, required: Object.keys(defaults) },
				];
			}),
		),
	};
}

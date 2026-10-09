import {
	resolveStylizedEffectJson,
	stylizedEffectCatalogJson,
} from "opencut-wasm";
import type { NumberParamDefinition } from "../../params";
import type { EffectDefinition, EffectPass } from "../types";

interface StylizedCatalogEntry {
	id: string;
	version: number;
	name: string;
	animated: boolean;
	fields: Omit<NumberParamDefinition, "type">[];
}

const catalog: StylizedCatalogEntry[] = JSON.parse(stylizedEffectCatalogJson());

export const stylizedEffectDefinitions: EffectDefinition[] = catalog.map(
	(entry) => ({
		type: entry.id,
		name: entry.name,
		keywords: [entry.id, "retro", "stylized"],
		params: entry.fields.map((field) => ({ ...field, type: "number" })),
		renderer: {
			passes: [],
			buildPasses: ({ effectParams, frame }) => {
				if (!frame)
					throw new Error(`${entry.name} requires an explicit effect frame`);
				const result: { passes?: EffectPass[]; error?: string } = JSON.parse(
					resolveStylizedEffectJson(
						JSON.stringify({
							effectType: entry.id,
							params: effectParams,
							localTime: frame.localTime,
							frameRate: frame.frameRate,
						}),
					),
				);
				if (result.error || !result.passes)
					throw new Error(result.error ?? "Missing effect passes");
				return result.passes;
			},
		},
	}),
);

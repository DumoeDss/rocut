import { effectsRegistry } from "../registry";
import { blurEffectDefinition } from "./blur";

const defaultEffects = [blurEffectDefinition];

export function registerDefaultEffects(): void {
	for (const definition of defaultEffects) {
		if (effectsRegistry.has(definition.type)) {
			if (effectsRegistry.get(definition.type) !== definition) {
				throw new Error(
					`Conflicting default effect definition at key "${definition.type}".`,
				);
			}
			continue;
		}
		effectsRegistry.register({
			key: definition.type,
			definition,
		});
	}
}

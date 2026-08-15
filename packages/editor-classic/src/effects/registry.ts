import { DefinitionRegistry } from "../params/registry";
import type { EffectDefinition } from "./types";

export class EffectsRegistry extends DefinitionRegistry<string, EffectDefinition> {
	constructor() {
		super("effect");
	}
}

export const effectsRegistry = new EffectsRegistry();

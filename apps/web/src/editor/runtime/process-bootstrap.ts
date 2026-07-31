import { effectsRegistry, registerDefaultEffects } from "@/effects";
import { graphicsRegistry, registerDefaultGraphics } from "@/graphics";
import { masksRegistry, registerDefaultMasks } from "@/masks";
import { elementParamRegistry } from "@/params/registry";
import { registerDefaultStickerProviders } from "@/stickers/providers";
import { stickersRegistry } from "@/stickers/registry";

let bootstrapSnapshot: ReadonlyArray<{
	name: string;
	read: () => readonly unknown[];
	definitions: readonly unknown[];
}> | null = null;

function registryReaders(): ReadonlyArray<{
	name: string;
	read: () => readonly unknown[];
}> {
	return [
		{ name: "effect", read: () => effectsRegistry.getAll() },
		{ name: "mask", read: () => masksRegistry.getAll() },
		{ name: "graphic", read: () => graphicsRegistry.getAll() },
		{ name: "parameter", read: () => elementParamRegistry.getAll() },
		{ name: "sticker", read: () => stickersRegistry.getAll() },
	];
}

/**
 * Register process-wide definitions once, before any session-owned core exists.
 *
 * The parameter registry is imported deliberately: its built-in definitions are
 * materialized by that module, while the remaining registries expose explicit
 * idempotent registration functions.
 */
export function ensureEditorProcessBootstrap(): void {
	if (bootstrapSnapshot) {
		for (const snapshot of bootstrapSnapshot) {
			const current = snapshot.read();
			if (
				snapshot.definitions.some((definition) => !current.includes(definition))
			) {
				throw new Error(
					`A bootstrapped default ${snapshot.name} definition was replaced.`,
				);
			}
		}
		return;
	}

	registerDefaultEffects();
	registerDefaultMasks();
	registerDefaultGraphics();
	registerDefaultStickerProviders();
	// Reading the registry makes the parameter bootstrap explicit instead of an
	// accidental side effect of constructing an EditorCore.
	elementParamRegistry.getAll();
	bootstrapSnapshot = registryReaders().map(({ name, read }) => ({
		name,
		read,
		definitions: read(),
	}));
}

export function isEditorProcessBootstrapped(): boolean {
	return bootstrapSnapshot !== null;
}

import { stickersRegistry } from "../registry";
import type { StickerProvider } from "../types";
import { flagsProvider } from "./flags";
import { logosProvider } from "./logos";
import { shapesProvider } from "./shapes";

const defaultProviders: StickerProvider[] = [
	logosProvider,
	flagsProvider,
	shapesProvider,
];

export function registerDefaultStickerProviders({
	providersToRegister = defaultProviders,
}: {
	providersToRegister?: StickerProvider[];
} = {}): void {
	for (const provider of providersToRegister) {
		if (stickersRegistry.has(provider.id)) {
			if (
				defaultProviders.includes(provider) &&
				stickersRegistry.get(provider.id) !== provider
			) {
				throw new Error(
					`Conflicting default sticker definition at key "${provider.id}".`,
				);
			}
			continue;
		}
		stickersRegistry.register({ key: provider.id, definition: provider });
	}
}

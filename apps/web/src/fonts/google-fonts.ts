import type { AssetResolver, RuntimeAssetLoader } from "@/editor/ports";
import type { FontAtlas, FontAtlasEntry } from "@/fonts/types";
import { SYSTEM_FONTS } from "@/fonts/system-fonts";

const GOOGLE_FONTS_CSS = "https://fonts.googleapis.com/css2";
const FONT_ATLAS_REF = { path: "fonts/font-atlas.json" } as const;

const fullLoaded = new Set<string>();
interface AtlasCache {
	atlas: FontAtlas | null;
	promise: Promise<FontAtlas | null> | null;
}
let atlasCaches = new WeakMap<object, AtlasCache>();

function cacheFor(loader: RuntimeAssetLoader): AtlasCache {
	const key = loader as object;
	let cache = atlasCaches.get(key);
	if (!cache) {
		cache = { atlas: null, promise: null };
		atlasCaches.set(key, cache);
	}
	return cache;
}

function isAtlasEntry(value: unknown): value is FontAtlasEntry {
	if (!value || typeof value !== "object") return false;
	const entry = value as Partial<FontAtlasEntry>;
	return (
		Number.isFinite(entry.x) &&
		Number.isFinite(entry.y) &&
		Number.isFinite(entry.w) &&
		Number.isInteger(entry.ch) &&
		(entry.ch ?? -1) >= 0 &&
		Array.isArray(entry.s) &&
		entry.s.every((item) => typeof item === "string")
	);
}

export function validateFontAtlas(value: unknown): FontAtlas {
	if (!value || typeof value !== "object") {
		throw new Error("Font atlas must be an object.");
	}
	const fonts = (value as { fonts?: unknown }).fonts;
	if (!fonts || typeof fonts !== "object" || Array.isArray(fonts)) {
		throw new Error("Font atlas must contain a fonts object.");
	}
	const entries = Object.entries(fonts);
	if (entries.length === 0) throw new Error("Font atlas must not be empty.");
	for (const [family, entry] of entries) {
		if (!family || !isAtlasEntry(entry)) {
			throw new Error(`Font atlas entry is invalid: ${family || "<empty>"}`);
		}
	}
	return value as FontAtlas;
}

function encodeGoogleFontsFamily(family: string): string {
	return family.replace(/ /g, "+");
}

export function getCachedFontAtlas({
	loader,
}: {
	loader: RuntimeAssetLoader;
}): FontAtlas | null {
	return atlasCaches.get(loader as object)?.atlas ?? null;
}

export function clearFontAtlasCache({
	loader,
}: {
	loader?: RuntimeAssetLoader;
} = {}): void {
	if (loader) atlasCaches.delete(loader as object);
	else atlasCaches = new WeakMap<object, AtlasCache>();
	fullLoaded.clear();
}

export function fontChunkUrl({
	resolver,
	chunk,
}: {
	resolver: AssetResolver;
	chunk: number;
}): string {
	return resolver.resolve({ ref: { path: `fonts/font-chunk-${chunk}.avif` } });
}

export function quoteCssUrl(value: string): string {
	return `url("${value
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"')
		.replace(/[\r\n\f]/g, "\\a ")}")`;
}

export function loadFontAtlas({
	loader,
	resolver,
}: {
	loader: RuntimeAssetLoader;
	resolver: AssetResolver;
}): Promise<FontAtlas | null> {
	const cache = cacheFor(loader);
	if (cache.atlas) return Promise.resolve(cache.atlas);
	if (cache.promise) return cache.promise;

	cache.promise = loader
		.loadJson({ ref: FONT_ATLAS_REF })
		.then((data) => {
			const atlas = validateFontAtlas(data);
			cache.atlas = atlas;
			preloadChunkImages({ atlas, resolver });
			return atlas;
		})
		.catch(() => null);
	return cache.promise;
}

function preloadChunkImages({
	atlas,
	resolver,
}: {
	atlas: FontAtlas;
	resolver: AssetResolver;
}): void {
	if (typeof Image === "undefined") return;
	const maxChunk = Math.max(...Object.values(atlas.fonts).map((entry) => entry.ch));
	for (let i = 0; i <= maxChunk; i++) {
		const img = new Image();
		img.src = fontChunkUrl({ resolver, chunk: i });
	}
}

export async function loadFullFont({
	family,
	weights = [400, 700],
}: {
	family: string;
	weights?: number[];
}): Promise<void> {
	if (fullLoaded.has(family)) return;
	const url = `${GOOGLE_FONTS_CSS}?family=${encodeGoogleFontsFamily(family)}:wght@${weights.join(";")}&display=swap`;
	const link = document.createElement("link");
	link.rel = "stylesheet";
	link.href = url;
	document.head.appendChild(link);
	await new Promise<void>((resolve) => {
		link.addEventListener("load", () => resolve(), { once: true });
		link.addEventListener("error", () => resolve(), { once: true });
	});
	await Promise.all(
		weights.map((weight) =>
			document.fonts.load(`${weight} 16px "${family.replace(/"/g, '\\"')}"`),
		),
	);
	fullLoaded.add(family);
}

export async function loadFonts({ families }: { families: string[] }): Promise<void> {
	const googleFonts = families.filter((family) => !SYSTEM_FONTS.has(family));
	await Promise.all(googleFonts.map((family) => loadFullFont({ family })));
}

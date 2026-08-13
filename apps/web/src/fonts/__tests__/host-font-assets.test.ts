import { beforeEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
	BrowserAssetResolver,
	BrowserRuntimeAssetLoader,
} from "@/editor/host/browser-runtime";
import type { RuntimeAssetLoader } from "@opencut/editor-ports";
import {
	clearFontAtlasCache,
	fontChunkUrl,
	getCachedFontAtlas,
	loadFontAtlas,
	quoteCssUrl,
	validateFontAtlas,
} from "../google-fonts";

function atlas(label: string, chunk: number) {
	return { fonts: { [label]: { x: 0, y: 0, w: 20, ch: chunk, s: [] } } };
}

function loaderFor(value: unknown): RuntimeAssetLoader & { calls: string[] } {
	const calls: string[] = [];
	return {
		calls,
		async loadBytes() {
			throw new Error("unused");
		},
		async loadJson<T = unknown>({
			ref,
		}: Parameters<RuntimeAssetLoader["loadJson"]>[0]) {
			calls.push(ref.path);
			return value as T;
		},
	};
}

beforeEach(() => clearFontAtlasCache());

describe("Host-scoped font assets", () => {
	test("loads and caches atlas data by loader identity, never first session", async () => {
		const one = loaderFor(atlas("One", 1));
		const two = loaderFor(atlas("Two", 2));
		const firstResolver = new BrowserAssetResolver("/one/");
		const secondResolver = new BrowserAssetResolver("/two/");
		expect(
			await loadFontAtlas({ loader: one, resolver: firstResolver }),
		).toEqual(atlas("One", 1));
		expect(
			await loadFontAtlas({ loader: two, resolver: secondResolver }),
		).toEqual(atlas("Two", 2));
		expect(
			await loadFontAtlas({ loader: one, resolver: firstResolver }),
		).toEqual(atlas("One", 1));
		expect(one.calls).toEqual(["fonts/font-atlas.json"]);
		expect(two.calls).toEqual(["fonts/font-atlas.json"]);
		expect(getCachedFontAtlas({ loader: one })).not.toBe(
			getCachedFontAtlas({ loader: two }),
		);
		expect(fontChunkUrl({ resolver: firstResolver, chunk: 1 })).toBe(
			"/one/fonts/font-chunk-1.avif",
		);
		expect(fontChunkUrl({ resolver: secondResolver, chunk: 2 })).toBe(
			"/two/fonts/font-chunk-2.avif",
		);
	});

	test("rejects missing, empty, or malformed atlas entries", () => {
		for (const value of [
			null,
			{},
			{ fonts: {} },
			{ fonts: { Bad: { ch: -1 } } },
		]) {
			expect(() => validateFontAtlas(value)).toThrow(/atlas/i);
		}
	});

	test("quotes opaque CSS URLs with spaces, quotes and encoded characters", () => {
		expect(quoteCssUrl('/base with space/font%20one"x.avif')).toBe(
			'url("/base with space/font%20one\\"x.avif")',
		);
		expect(quoteCssUrl("/base/line\nbreak.avif")).toBe(
			'url("/base/line\\a break.avif")',
		);
	});

	test("fails closed on an HTML atlas fallback and propagates an aborted atlas request", async () => {
		const htmlLoader = new BrowserRuntimeAssetLoader(
			new BrowserAssetResolver("/nested/"),
			async () =>
				new Response("<html>fallback</html>", {
					headers: { "content-type": "text/html" },
				}),
		);
		expect(
			await loadFontAtlas({
				loader: htmlLoader,
				resolver: new BrowserAssetResolver("/nested/"),
			}),
		).toBeNull();

		const controller = new AbortController();
		const abortedLoader = new BrowserRuntimeAssetLoader(
			new BrowserAssetResolver("/aborted/"),
			async (_input, init) =>
				await new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener(
						"abort",
						() =>
							reject(
								init.signal?.reason ??
									new DOMException("Aborted", "AbortError"),
							),
						{ once: true },
					);
				}),
		);
		const aborted = abortedLoader.loadJson({
			ref: { path: "fonts/font-atlas.json" },
			signal: controller.signal,
		});
		controller.abort(new DOMException("C4 atlas abort", "AbortError"));
		await expect(aborted).rejects.toThrow(/C4 atlas abort|Abort/i);
	});

	test("keeps two bases' preloads, masks, and visible atlas names isolated", async () => {
		const originalImage = globalThis.Image;
		const preloads: string[] = [];
		class RecordingImage {
			private value = "";
			set src(value: string) {
				this.value = value;
				preloads.push(value);
			}
			get src() {
				return this.value;
			}
		}
		(globalThis as unknown as { Image: typeof Image }).Image =
			RecordingImage as unknown as typeof Image;
		try {
			const first = loaderFor(atlas("Visible One", 1));
			const second = loaderFor(atlas("Visible Two", 2));
			const firstResolver = new BrowserAssetResolver("/host-one/");
			const secondResolver = new BrowserAssetResolver("/host-two/");
			const firstAtlas = await loadFontAtlas({
				loader: first,
				resolver: firstResolver,
			});
			const secondAtlas = await loadFontAtlas({
				loader: second,
				resolver: secondResolver,
			});

			expect(Object.keys(firstAtlas?.fonts ?? {})).toEqual(["Visible One"]);
			expect(Object.keys(secondAtlas?.fonts ?? {})).toEqual(["Visible Two"]);
			expect(first.calls).toEqual(["fonts/font-atlas.json"]);
			expect(second.calls).toEqual(["fonts/font-atlas.json"]);
			expect(preloads.filter((url) => url.startsWith("/host-one/"))).toEqual([
				"/host-one/fonts/font-chunk-0.avif",
				"/host-one/fonts/font-chunk-1.avif",
			]);
			expect(preloads.filter((url) => url.startsWith("/host-two/"))).toEqual([
				"/host-two/fonts/font-chunk-0.avif",
				"/host-two/fonts/font-chunk-1.avif",
				"/host-two/fonts/font-chunk-2.avif",
			]);
			expect(
				quoteCssUrl(fontChunkUrl({ resolver: firstResolver, chunk: 1 })),
			).toBe('url("/host-one/fonts/font-chunk-1.avif")');
			expect(
				quoteCssUrl(fontChunkUrl({ resolver: secondResolver, chunk: 2 })),
			).toBe('url("/host-two/fonts/font-chunk-2.avif")');
		} finally {
			(globalThis as unknown as { Image: typeof Image }).Image = originalImage;
		}
	});

	test("decodes a shipped font chunk and rejects corrupt chunk bytes", async () => {
		const { loadImage } = await import("@napi-rs/canvas");
		const bytes = await readFile(
			resolve(process.cwd(), "apps/web/public/fonts/font-chunk-0.avif"),
		);
		const image = await loadImage(bytes);
		expect(image.width).toBeGreaterThan(0);
		expect(image.height).toBeGreaterThan(0);
		await expect(loadImage(Buffer.from("not-an-image"))).rejects.toThrow();
	});
});

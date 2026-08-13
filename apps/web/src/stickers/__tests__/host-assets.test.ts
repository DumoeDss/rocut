import { describe, expect, test } from "bun:test";
import { BrowserAssetResolver } from "@/editor/host/browser-runtime";
import { buildFlagUrl, flagsProvider } from "@/stickers/providers/flags";
import { stickerSourceCacheKey } from "@/services/renderer/nodes/sticker-cache-key";
import { buildGeneratedGraphicPreviewUrl } from "@/graphics/generated-preview";

describe("Host-scoped sticker assets", () => {
	test("resolves flag browse/resolve URLs through each immutable Host base", async () => {
		const one = new BrowserAssetResolver("/one/");
		const two = new BrowserAssetResolver("/two/");
		expect(buildFlagUrl({ code: "US", assets: one })).toBe("/one/flags/us.svg");
		expect(buildFlagUrl({ code: "US", assets: two })).toBe("/two/flags/us.svg");
		expect(
			flagsProvider.resolveUrl({ stickerId: "flags:US", assets: one }),
		).toBe("/one/flags/us.svg");
		const first = await flagsProvider.search({
			query: "United States",
			assets: one,
		});
		const second = await flagsProvider.search({
			query: "United States",
			assets: two,
		});
		expect(first.items[0]?.previewUrl.startsWith("/one/flags/")).toBe(true);
		expect(second.items[0]?.previewUrl.startsWith("/two/flags/")).toBe(true);
	});

	test("keys loaded sticker images by resolved URL and dimensions", () => {
		expect(
			stickerSourceCacheKey({
				url: "/one/flags/us.svg",
				width: 200,
				height: 200,
			}),
		).toBe("/one/flags/us.svg|200x200");
		expect(
			stickerSourceCacheKey({
				url: "/two/flags/us.svg",
				width: 200,
				height: 200,
			}),
		).not.toBe(
			stickerSourceCacheKey({
				url: "/one/flags/us.svg",
				width: 200,
				height: 200,
			}),
		);
		expect(
			stickerSourceCacheKey({
				url: "/one/flags/us.svg",
				width: 64,
				height: 64,
			}),
		).not.toBe(
			stickerSourceCacheKey({
				url: "/one/flags/us.svg",
				width: 200,
				height: 200,
			}),
		);
	});

	test("keeps generated graphic previews outside AssetResolver and first-party fetch", async () => {
		let resolverCalls = 0;
		let fetchCalls = 0;
		const assets = {
			resolve() {
				resolverCalls += 1;
				throw new Error("generated previews must not enter AssetResolver");
			},
		};
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () => {
			fetchCalls += 1;
			throw new Error("generated previews must not fetch");
		}) as unknown as typeof fetch;
		try {
			const previewUrl = buildGeneratedGraphicPreviewUrl({
				name: "C4 generated rectangle",
				size: 96,
			});
			expect(previewUrl.startsWith("data:image/svg+xml")).toBe(true);
			const [, encoded = ""] = previewUrl.split(",", 2);
			const markup = previewUrl.includes(";base64,")
				? Buffer.from(encoded, "base64").toString("utf8")
				: decodeURIComponent(encoded);
			expect(markup).toMatch(/<svg[\s>]/);
			expect(markup).toMatch(/<(?:path|rect|ellipse|polygon|circle)[\s>]/);
			const { createCanvas, loadImage } = await import("@napi-rs/canvas");
			const svgImage = await loadImage(Buffer.from(markup));
			expect(svgImage.width).toBe(96);
			expect(svgImage.height).toBe(96);
			const canvas = createCanvas(32, 32);
			const context = canvas.getContext("2d");
			context.fillStyle = "#16a9f3";
			context.fillRect(0, 0, 32, 32);
			const canvasDataUrl = canvas.toDataURL("image/png");
			const canvasImage = await loadImage(
				Buffer.from(canvasDataUrl.split(",", 2)[1] ?? "", "base64"),
			);
			expect(canvasImage.width).toBe(32);
			expect(canvasImage.height).toBe(32);
			void assets;
			expect(resolverCalls).toBe(0);
			expect(fetchCalls).toBe(0);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});

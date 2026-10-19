import { expect, test } from "bun:test";
import { createHttpMediaPreviews } from "./http-media-previews";

const args = {
	mediaId: "media-1",
	sourceSha256: "a".repeat(64),
	timeSeconds: 0.5,
	signal: new AbortController().signal,
};
const headers = {
	"content-type": "image/png",
	"x-rocut-preview-version": "1",
	"x-rocut-source-sha256": args.sourceSha256,
	"content-length": "40",
};

test("old hosts do not receive a native decode request", async () => {
	let calls = 0;
	const provider = createHttpMediaPreviews({
		fetchImpl: async () => {
			calls++;
			return new Response("not-found", { status: 404 });
		},
	});
	expect(await provider.renderFrame(args)).toBeNull();
	expect(await provider.renderFrame(args)).toBeNull();
	expect(calls).toBe(1);
});

test("native transport sends only fixed identity/time and returns bounded bytes", async () => {
	let calls = 0;
	const provider = createHttpMediaPreviews({
		base: "api",
		fetchImpl: async (url, init) => {
			calls++;
			expect(url).toBe("api/media/preview");
			if (!init?.method) return Response.json({ version: 1, available: true });
			expect(JSON.parse(String(init.body))).toEqual({
				mediaId: args.mediaId,
				sourceSha256: args.sourceSha256,
				timeSeconds: 0.5,
			});
			return new Response(new Uint8Array(40), { headers });
		},
	});
	expect((await provider.renderFrame(args))?.body.byteLength).toBe(40);
	expect(calls).toBe(2);
});

test("native transport rejects wrong identity, truncated/oversized body, wrong MIME and unversioned responses", async () => {
	for (const response of [
		new Response(new Uint8Array(40), {
			headers: { ...headers, "x-rocut-source-sha256": "b".repeat(64) },
		}),
		new Response(new Uint8Array(40), {
			headers: { ...headers, "content-type": "text/html" },
		}),
		new Response(new Uint8Array(40), {
			headers: { ...headers, "x-rocut-preview-version": "2" },
		}),
		new Response(new Uint8Array(39), { headers }),
		new Response(new Uint8Array(41), { headers }),
		new Response(new Uint8Array(40), {
			headers: { ...headers, "content-length": String(1024 * 1024 + 1) },
		}),
	]) {
		const provider = createHttpMediaPreviews({
			fetchImpl: async (_url, init) =>
				!init?.method
					? Response.json({ version: 1, available: true })
					: response,
		});
		await expect(provider.renderFrame(args)).rejects.toThrow();
	}
});

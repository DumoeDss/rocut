import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { prepareTunnelFontPacket } from "../../packages/editor-classic/src/services/renderer/programmatic/mv-tunnel-font-packet";
const limits = { maxBytes: 64, maxResources: 6, maxLayoutBytes: 1024 };
function fixture() {
	const body = new Uint8Array([1, 2, 3]).buffer;
	const sha256 = createHash("sha256")
		.update(new Uint8Array(body))
		.digest("hex");
	const resource = {
		id: "font",
		kind: "font" as const,
		attachmentKey: `programmatic-sha256-${sha256}`,
		mimeType: "font/ttf",
		byteLength: body.byteLength,
		sha256,
		font: { family: "Test", style: "normal" as const, weight: 400 },
	};
	return { body, resource };
}
test("font packet preserves Rust-selected order and owns verified bytes", async () => {
	const f = fixture();
	const result = await prepareTunnelFontPacket({
		requests: [f.resource],
		limits,
		resources: [{ resource: f.resource, body: f.body }],
	});
	new Uint8Array(f.body)[0] = 99;
	expect([...result.packet.bytes]).toEqual([1, 2, 3]);
	expect(JSON.parse(result.packet.layout)).toEqual([
		{ id: "font", offset: 0, length: 3 },
	]);
});
test("changed bytes/missing identity/limits/abort never yield a font packet", async () => {
	const f = fixture();
	new Uint8Array(f.body)[0] = 99;
	await expect(
		prepareTunnelFontPacket({
			requests: [f.resource],
			limits,
			resources: [{ resource: f.resource, body: f.body }],
		}),
	).rejects.toThrow("digest mismatch");
	const good = fixture();
	await expect(
		prepareTunnelFontPacket({
			requests: [{ ...good.resource, id: "missing" }],
			limits,
			resources: [{ resource: good.resource, body: good.body }],
		}),
	).rejects.toThrow("identity mismatch");
	await expect(
		prepareTunnelFontPacket({
			requests: [good.resource],
			limits: { ...limits, maxBytes: 2 },
			resources: [{ resource: good.resource, body: good.body }],
		}),
	).rejects.toThrow("Rust limits");
	const controller = new AbortController();
	controller.abort(Error("aborted"));
	await expect(
		prepareTunnelFontPacket({
			requests: [good.resource],
			limits,
			resources: [{ resource: good.resource, body: good.body }],
			signal: controller.signal,
		}),
	).rejects.toThrow("aborted");
});

test("Rust descriptor key order is irrelevant but nested font identity is not", async () => {
	const f = fixture();
	const resource = {
		...f.resource,
		font: { ...f.resource.font, axes: { wght: 400, slnt: 0 } },
	};
	const request = {
		font: {
			axes: { slnt: 0, wght: 400 },
			weight: 400,
			style: "normal" as const,
			family: "Test",
		},
		sha256: resource.sha256,
		byteLength: 3,
		mimeType: "font/ttf",
		attachmentKey: resource.attachmentKey,
		kind: "font" as const,
		id: "font",
	};
	const result = await prepareTunnelFontPacket({
		requests: [request],
		limits,
		resources: [{ resource, body: f.body }],
	});
	expect([...result.packet.bytes]).toEqual([1, 2, 3]);
	for (const font of [
		{ ...request.font, weight: 800 },
		{ ...request.font, axes: { slnt: 0, wght: 800 } },
		{ ...request.font, family: "Other" },
	])
		await expect(
			prepareTunnelFontPacket({
				requests: [{ ...request, font }],
				limits,
				resources: [{ resource, body: f.body }],
			}),
		).rejects.toThrow("snapshot identity mismatch");
});

import { expect, test } from "bun:test";
import { pinnedTextFont } from "../nodes/text-font-resource";

test("ordinary text can reference only a bounded immutable project font attachment", () => {
	const resource = {
		id: "font",
		kind: "font",
		mimeType: "font/ttf",
		byteLength: 100,
		sha256: "a".repeat(64),
		attachmentKey: `programmatic-sha256-${"a".repeat(64)}`,
		font: { family: "Fixture", style: "normal", weight: 400 },
	};
	expect(pinnedTextFont(JSON.stringify(resource))).toMatchObject({
		source: "project",
		assetId: resource.attachmentKey,
		contentDigest: resource.sha256,
		family: "Fixture",
	});
	expect(pinnedTextFont(undefined)).toBeUndefined();
	expect(pinnedTextFont("")).toBeUndefined();
	for (const patch of [
		{ kind: "image" },
		{ attachmentKey: "../font.ttf" },
		{ byteLength: 0 },
		{ mimeType: "text/plain" },
		{ font: undefined },
		{ font: { ...resource.font, weight: 0 } },
	])
		expect(() =>
			pinnedTextFont(JSON.stringify({ ...resource, ...patch })),
		).toThrow();
});

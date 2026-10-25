import { expect, test } from "bun:test";
import { pinnedTextFont } from "../nodes/text-font-resource";

test("the built native font admission is consumed without a renderer or a replacement parser", () => {
	const descriptor = {
		id: "fonts/title.ttf",
		kind: "font",
		mimeType: "font/ttf",
		attachmentKey: `programmatic-sha256-${"a".repeat(64)}`,
		sha256: "a".repeat(64),
		byteLength: 8,
		font: { family: "Title", style: "normal", weight: 400 },
	};
	expect(pinnedTextFont(JSON.stringify(descriptor), undefined, "Title"))
		.toEqual({
			id: "fonts/title.ttf", source: "project",
			assetId: descriptor.attachmentKey, contentDigest: descriptor.sha256,
			family: "Title", style: "normal", weight: 400,
		});
	expect(() => pinnedTextFont(JSON.stringify(descriptor), undefined, "Other"))
		.toThrow("differs from its fixed source");
	expect(() => pinnedTextFont("{bad-json}")).toThrow("JSON");
});

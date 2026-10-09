import { expect, test } from "bun:test";
import { loadFlameExportResource } from "./mv-flame-export-resource";
import type { ResolvedProgrammaticResource } from "@opencut/editor-contracts";

const item: ResolvedProgrammaticResource = {
	body: new Uint8Array([1, 2, 3]).buffer,
	resource: {
		id: "flame-marker",
		kind: "image",
		mimeType: "image/png",
		byteLength: 3,
		sha256: "a".repeat(64),
		attachmentKey: `programmatic-sha256-${"a".repeat(64)}`,
	},
};
test("Flame export attachment full identity accepts arbitrary key order", async () => {
	const resource = Object.fromEntries(Object.entries(item.resource).reverse());
	const blob = loadFlameExportResource({ resources: [item], resource });
	expect(blob.type).toBe("image/png");
	expect(new Uint8Array(await blob.arrayBuffer())).toEqual(
		new Uint8Array([1, 2, 3]),
	);
});
test("Flame export full identity rejects changed fields and extra keys", () => {
	for (const patch of [
		{ id: "other" },
		{ kind: "analysis" },
		{ mimeType: "image/jpeg" },
		{ byteLength: 4 },
		{ sha256: "b".repeat(64) },
		{ attachmentKey: "different" },
		{ extra: true },
	])
		expect(() =>
			loadFlameExportResource({
				resources: [item],
				resource: { ...item.resource, ...patch },
			}),
		).toThrow();
});

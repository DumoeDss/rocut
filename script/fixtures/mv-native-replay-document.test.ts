import { expect, test } from "bun:test";
import { MV_NATIVE_DOCUMENT } from "../../packages/editor-classic/src/services/renderer/programmatic/mv-native-document";
import { nativeReplayDocument } from "./mv-native-replay-document";

test("scheduling diagnostics preserve the default production document exactly", () => {
	expect(nativeReplayDocument(MV_NATIVE_DOCUMENT)).toBe(MV_NATIVE_DOCUMENT);
	expect(nativeReplayDocument(MV_NATIVE_DOCUMENT, 64)).toBe(MV_NATIVE_DOCUMENT);
	for (const batch of [1, 4096] as const) {
		const result = nativeReplayDocument(MV_NATIVE_DOCUMENT, batch);
		expect(result).not.toBe(MV_NATIVE_DOCUMENT);
		expect(result.replace(`count < ${batch}`, "count < 64")).toBe(
			MV_NATIVE_DOCUMENT,
		);
	}
});

test("scheduling diagnostics reject invalid sizes and stale/ambiguous anchors", () => {
	for (const document of [
		"",
		"count < 640; count++",
		"count < 64; count++; count < 64; count++",
	])
		expect(() => nativeReplayDocument(document, 1)).toThrow(
			"exact batch anchor",
		);
	expect(() => nativeReplayDocument(MV_NATIVE_DOCUMENT, 2 as 1)).toThrow(
		"batch size",
	);
});

import type { MotionTextFontAssetRef } from "@opencut/editor-contracts";
import * as wasm from "opencut-wasm";

/** A pinned text face is stored with the clip, while its bytes remain a project attachment. */
export function pinnedTextFont(
	value: unknown,
	core?: (input: string) => string,
	family?: string,
): MotionTextFontAssetRef | undefined {
	if (value === undefined || value === "") return undefined;
	const candidate: unknown =
		core ?? Reflect.get(wasm, "resolvePinnedTextFontJson");
	if (typeof candidate !== "function")
		throw Error(
			"The installed native runtime does not support pinned text font admission",
		);
	const response = JSON.parse(
		candidate(JSON.stringify({ version: 1, value, family })),
	);
	if (!response || response.version !== 1)
		throw Error("Invalid native text font response");
	if (response.error) throw Error(String(response.error));
	return response.font ?? undefined;
}

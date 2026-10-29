import { readFile } from "node:fs/promises";
import { request } from "./host-request";
import type { ResolvedTarget } from "./target-registry";
import { musicAnchorFileSource } from "./music-anchor-resource";

export async function runMusicGridCli(
	positional: readonly string[],
	resolved: Pick<ResolvedTarget, "secret">,
	io: {
		request?: typeof request;
		readSpec?: (path: string) => Promise<Uint8Array>;
	} = {},
): Promise<unknown> {
	const [action, file] = positional;
	const invoke = io.request ?? request;
	if (action === "project-anchors" && positional.length === 3 && file) {
		const read = io.readSpec ?? readFile;
		const query = JSON.parse(
			new TextDecoder("utf-8", { fatal: true }).decode(await read(file)),
		);
		if (
			!query ||
			typeof query !== "object" ||
			Array.isArray(query) ||
			"anchorSource" in query
		)
			throw Error("Anchor query must reference the separate reviewed file");
		return invoke(resolved.secret, "POST", "music-grid/query", {
			...query,
			kind: "project-anchors",
			anchorSource: musicAnchorFileSource(await read(positional[2]!)),
		});
	}
	if (
		["capabilities", "bindings"].includes(action ?? "") &&
		positional.length === 1
	)
		return invoke(resolved.secret, "GET", `music-grid/${action}`);
	if (
		!["read", "list", "snap", "validate", "plan", "edit"].includes(
			action ?? "",
		) ||
		!file ||
		positional.length !== 2
	)
		throw Error(
			"usage: rocut music-grid capabilities|bindings|read|list|snap|validate|plan|edit <spec.json>",
		);
	const bytes = await (io.readSpec ?? readFile)(file);
	if (bytes.byteLength > 8 * 1024 ** 2)
		throw Error("Music-grid spec exceeds JSON limit");
	const spec: unknown = JSON.parse(
		new TextDecoder("utf-8", { fatal: true }).decode(bytes),
	);
	if (!spec || typeof spec !== "object" || Array.isArray(spec))
		throw Error("Music-grid spec must be an object");
	if (["plan", "edit"].includes(action!))
		return invoke(resolved.secret, "POST", `music-grid/${action}`, spec);
	if ("kind" in spec && spec.kind !== action)
		throw Error("Music-grid query kind does not match CLI verb");
	return invoke(resolved.secret, "POST", "music-grid/query", {
		...spec,
		kind: action,
	});
}

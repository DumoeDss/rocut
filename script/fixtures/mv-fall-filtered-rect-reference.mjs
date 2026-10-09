import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
export async function fallFilterReference(root) {
	const path = join(
		root,
		"skills/vocaloid-style-mv/template/engine/scenes/dark.js",
	);
	const bytes = await readFile(path);
	const sha256 = createHash("sha256").update(bytes).digest("hex");
	if (
		sha256 !==
		"4b20e29e78b30ae67c350e4622ae60933137b00cbcedbe858ed7c652536a55bd"
	)
		throw Error(
			"Original complete dark.js identity changed; review before acceptance",
		);
	const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	const start = source.indexOf("  let streakSprite = null;");
	const end = source.indexOf("  Z.scene('fall', {", start);
	if (start < 0 || end < start)
		throw Error("Missing original streak definition");
	const definition = source.slice(start, end);
	return {
		path,
		sha256,
		definition,
		definitionSha256: createHash("sha256").update(definition).digest("hex"),
	};
}

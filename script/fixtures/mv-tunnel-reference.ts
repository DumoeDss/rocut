import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

export const TUNNEL_REFERENCE_FILES = [
	"core/util.js",
	"core/assets.js",
	"core/draw.js",
	"scenes/typo.js",
] as const;
export interface TunnelReference {
	readonly scripts: readonly {
		readonly id: string;
		readonly code: string;
		readonly sha256: string;
	}[];
}
/** Full unchanged scripts, strict original-byte identity; no helper extraction. */
export async function loadTunnelReference(
	root: string,
): Promise<TunnelReference> {
	assert.ok(isAbsolute(root), "Tunnel reference requires an absolute checkout");
	const scripts = await Promise.all(
		TUNNEL_REFERENCE_FILES.map(async (id) => {
			const path = join(root, "skills/vocaloid-style-mv/template/engine", id);
			const info = await lstat(path);
			assert.ok(info.isFile() && info.size > 0 && info.size <= 1_000_000);
			const bytes = await readFile(path);
			assert.ok(
				!(bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191),
				"Unexpected BOM",
			);
			return {
				id,
				code: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
				sha256: createHash("sha256").update(bytes).digest("hex"),
			};
		}),
	);
	assert.ok(scripts[3]?.code.includes("Z.scene('tunnel',"));
	return { scripts };
}

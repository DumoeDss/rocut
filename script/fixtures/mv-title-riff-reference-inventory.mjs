import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { titleRiffFontIdentity } from "./mv-title-riff-reference-font-identity.ts";

const revision = "b8f2790b12018153309b61335c4887ce939fde37";
const mediumSha = "651a3f7280b7f36262601ee76d8388a8dc4372dcc67aff025a608939a562b525";
const licenseSha = "0fac78a235c98d640cb06332eb5362c211d86fa03c011df438c35005d22ad2c7";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Explicit allowlist; server never exposes arbitrary paths or installs fonts. */
export async function loadTitleRiffFontInventory(root, mediumPath) {
	if (!isAbsolute(root) || !mediumPath || !isAbsolute(mediumPath)) throw Error("Provide absolute ROCUT_TEST_TITLE_RIFF_GOTHIC500 plus its adjacent OFL.txt");
	const base = join(root, "apps", "web", "public", "motion-text", "fonts");
	const entries = [
		["zen-old-mincho-black.ttf", "Zen Old Mincho", 900, join(base, "zen-old-mincho-black.ttf"), join(base, "licenses", "zenoldmincho-OFL.txt")],
		["dot-gothic-16-regular.ttf", "DotGothic16", 400, join(base, "dot-gothic-16-regular.ttf"), join(base, "licenses", "dotgothic16-OFL.txt")],
		["noto-serif-jp-variable.ttf", "Noto Serif JP", 300, join(base, "noto-serif-jp-variable.ttf"), join(base, "licenses", "notoserifjp-OFL.txt")],
		["ZenKakuGothicNew-Medium.ttf", "Zen Kaku Gothic New", 500, mediumPath, join(dirname(mediumPath), "OFL.txt")],
	];
	const files = new Map(), fonts = [], provenance = [];
	for (const [id, family, weight, path, licensePath] of entries) {
		for (const [file, limit] of [[path, 16 * 1024 * 1024], [licensePath, 65536]]) {
			const stat = await lstat(file);
			if (!stat.isFile() || stat.size <= 0 || stat.size > limit) throw Error(`Invalid explicit titleRiff font/license file: ${file}`);
		}
		const body = await readFile(path), license = await readFile(licensePath);
		if (family === "Zen Kaku Gothic New" && (sha(body) !== mediumSha || sha(license) !== licenseSha)) throw Error("Medium500 font/license do not match the recorded official source revision");
		const identity = titleRiffFontIdentity(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength), family, weight);
		const url = `/__title-riff-oracle-fonts/${id}`;
		files.set(url, body);
		fonts.push({ id, family, weight, url, mimeType: "font/ttf", byteLength: body.length, sha256: sha(body) });
		provenance.push({ id, path, identity, sha256: sha(body), licenseSha256: sha(license), licensePath,
			source: family === "Zen Kaku Gothic New" ? `https://raw.githubusercontent.com/google/fonts/${revision}/ofl/zenkakugothicnew/${id}` : "Existing Rocut JIZURA local font inventory",
			revision: family === "Zen Kaku Gothic New" ? revision : null });
	}
	return { files, fonts, provenance };
}

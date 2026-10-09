import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { titleRiffFontIdentity } from "./mv-title-riff-reference-font-identity.ts";

const revision = "b8f2790b12018153309b61335c4887ce939fde37";
const boldSha =
	"d20f3981afb8bceda5fdf8f0fb29ba51eb21518644612ccd8a183e5bd433e25a";
const licenseSha =
	"41fba056279be5f45ff9a99e44b7b53897b42732f5806d8e666e0ab49ac6bd38";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

export async function loadKanjiFontInventory(root, boldPath) {
	if (!isAbsolute(root) || !boldPath || !isAbsolute(boldPath))
		throw Error(
			"Provide absolute ROCUT_TEST_KANJI_SLAM_MINCHO700 with adjacent OFL.txt",
		);
	const base = join(root, "apps/web/public/motion-text/fonts");
	const entries = [
		[
			"zen-old-mincho-black.ttf",
			"Zen Old Mincho",
			900,
			join(base, "zen-old-mincho-black.ttf"),
			join(base, "licenses/zenoldmincho-OFL.txt"),
		],
		[
			"dot-gothic-16-regular.ttf",
			"DotGothic16",
			400,
			join(base, "dot-gothic-16-regular.ttf"),
			join(base, "licenses/dotgothic16-OFL.txt"),
		],
		[
			"ShipporiMinchoB1-Bold.ttf",
			"Shippori Mincho B1",
			700,
			boldPath,
			join(dirname(boldPath), "OFL.txt"),
		],
	];
	const files = new Map(),
		fonts = [],
		provenance = [];
	for (const [id, family, weight, path, licensePath] of entries) {
		for (const [file, limit] of [
			[path, 16 * 1024 * 1024],
			[licensePath, 65536],
		]) {
			const stat = await lstat(file);
			if (!stat.isFile() || stat.size <= 0 || stat.size > limit)
				throw Error(`Invalid explicit kanjiSlam font/license: ${file}`);
		}
		const body = await readFile(path),
			license = await readFile(licensePath);
		if (
			family === "Shippori Mincho B1" &&
			(sha(body) !== boldSha || sha(license) !== licenseSha)
		)
			throw Error(
				"Bold700 font/license do not match official pinned Google Fonts revision",
			);
		if (
			!new TextDecoder("utf-8", { fatal: true })
				.decode(license)
				.includes("SIL OPEN FONT LICENSE")
		)
			throw Error("Missing local OFL license text");
		const identity = titleRiffFontIdentity(
			body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
			family,
			weight,
		);
		const url = `/__kanji-slam-oracle-fonts/${id}`;
		files.set(url, body);
		fonts.push({
			id,
			family,
			weight,
			url,
			mimeType: "font/ttf",
			byteLength: body.length,
			sha256: sha(body),
		});
		provenance.push({
			id,
			path,
			identity,
			sha256: sha(body),
			licensePath,
			licenseSha256: sha(license),
			source:
				family === "Shippori Mincho B1"
					? `https://raw.githubusercontent.com/google/fonts/${revision}/ofl/shipporiminchob1/${id}`
					: "Existing Rocut JIZURA local font inventory",
			revision: family === "Shippori Mincho B1" ? revision : null,
		});
	}
	return { files, fonts, provenance };
}

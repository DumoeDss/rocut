import assert from "node:assert/strict";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative } from "node:path";
import { assertContained, sha256 } from "./probe-droplets-evidence.mjs";

export function highChromaSourceGuard(frozen, liveRepository) {
	const admitted = new Map(
		frozen.inputs.map((file) => [file.path, file.sha256]),
	);
	const loaded = new Map();
	const under = (root, path) => {
		const local = relative(root, path).replaceAll("\\", "/");
		return !local.startsWith("..") && !isAbsolute(local) ? local : null;
	};
	const source = (path) =>
		path?.startsWith("packages/") ||
		path?.startsWith("script/fixtures/") ||
		path?.startsWith("rust/");
	return {
		loaded,
		plugin: {
			name: "high-chroma-frozen-source-closure",
			enforce: "pre",
			async transform(_code, id) {
				if (id.startsWith("\0")) return null;
				const path = id.split("?")[0];
				if (!isAbsolute(path)) return null;
				const wasm = under(frozen.packageDirectory, path);
				if (wasm !== null && Object.hasOwn(frozen.packageHashes, wasm)) {
					assertContained(frozen.packageDirectory, await realpath(path));
					const hash = sha256(await readFile(path));
					assert.equal(
						hash,
						frozen.packageHashes[wasm],
						`Loaded WASM changed: ${wasm}`,
					);
					loaded.set(`WASM/${wasm}`, hash);
					return null;
				}
				const local = under(frozen.snapshot, path);
				if (!source(local)) {
					assert(
						!source(under(liveRepository, path)),
						`Import escaped into live source: ${path}`,
					);
					return null;
				}
				assert(admitted.has(local), `Source missing from manifest: ${local}`);
				assertContained(frozen.snapshot, await realpath(path));
				const hash = sha256(await readFile(path));
				assert.equal(
					hash,
					admitted.get(local),
					`Loaded source changed: ${local}`,
				);
				loaded.set(local, hash);
				return null;
			},
		},
	};
}

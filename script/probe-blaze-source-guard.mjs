import assert from "node:assert/strict";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative } from "node:path";
import { blazeContained, blazeSha256 } from "./probe-blaze-evidence.mjs";

/** Every transformed workspace source must be an admitted snapshot input. */
export function blazeSourceGuard(frozen, liveRepository) {
	const hashes = new Map(frozen.inputs.map((file) => [file.path, file.sha256]));
	const loaded = new Map();
	const under = (root, path) => {
		const candidate = relative(root, path).replaceAll("\\", "/");
		return !candidate.startsWith("..") && !isAbsolute(candidate)
			? candidate
			: null;
	};
	const source = (path) =>
		path?.startsWith("packages/") ||
		path?.startsWith("script/fixtures/") ||
		path?.startsWith("rust/");
	return {
		loaded,
		plugin: {
			name: "blaze-frozen-source-closure",
			enforce: "pre",
			async transform(_code, id) {
				if (id.startsWith("\0")) return null;
				const path = id.split("?")[0];
				if (!isAbsolute(path)) return null;
				const wasm = under(frozen.packageDirectory, path);
				if (wasm !== null && Object.hasOwn(frozen.packageHashes, wasm)) {
					blazeContained(frozen.packageDirectory, await realpath(path));
					const hash = blazeSha256(await readFile(path));
					assert.equal(
						hash,
						frozen.packageHashes[wasm],
						`Blaze loaded WASM input changed: ${wasm}`,
					);
					loaded.set(`WASM/${wasm}`, hash);
					return null;
				}
				const local = under(frozen.snapshot, path);
				if (!source(local)) {
					assert(
						!source(under(liveRepository, path)),
						`Blaze import escaped frozen snapshot into live source: ${path}`,
					);
					return null;
				}
				assert(
					hashes.has(local),
					`Blaze imported source missing from frozen manifest: ${local}`,
				);
				blazeContained(frozen.snapshot, await realpath(path));
				const hash = blazeSha256(await readFile(path));
				assert.equal(
					hash,
					hashes.get(local),
					`Blaze loaded source changed: ${local}`,
				);
				loaded.set(local, hash);
				return null;
			},
		},
	};
}

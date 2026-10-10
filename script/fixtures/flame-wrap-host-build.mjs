import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

const [workspace, pkg, root, creator] = process.argv.slice(2);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const files = new Map();
const entry = join(root, "entry.ts");
await writeFile(
	entry,
	`import { startHost } from ${JSON.stringify(join(workspace, "apps/cli/src/host.ts"))};
import { TargetRegistry } from ${JSON.stringify(join(workspace, "apps/cli/src/target-registry.ts"))};
import { run } from ${JSON.stringify(join(workspace, "script/fixtures/flame-wrap-host.mjs"))};
await run({ startHost, TargetRegistry, root: ${JSON.stringify(root)}, creator: ${JSON.stringify(creator)} });\n`,
	{ flag: "wx" },
);
const wasmEntry = join(pkg, "opencut_wasm_sync.js");
const result = await Bun.build({
	entrypoints: [entry],
	target: "bun",
	outdir: root,
	naming: "host.mjs",
	plugins: [
		{
			name: "private-wasm-and-source-pin",
			setup(build) {
				build.onResolve({ filter: /^opencut-wasm$/ }, () => ({
					path: wasmEntry,
					external: true,
				}));
				build.onLoad({ filter: /./ }, async ({ path, namespace, loader }) => {
					if (!path.startsWith("bun:")) {
						assert.equal(
							namespace,
							"file",
							`Unpinned source namespace: ${namespace}`,
						);
						assert.equal(
							typeof loader,
							"string",
							`Missing source loader: ${path}`,
						);
						const bytes = await readFile(path);
						const record = {
							path: resolve(path),
							sha256: sha(bytes),
							bytes: bytes.length,
							loader,
						};
						const previous = files.get(record.path);
						if (previous)
							assert.equal(
								record.sha256,
								previous.sha256,
								`During build changed: ${path}`,
							);
						files.set(record.path, record);
						return { contents: bytes, loader };
					}
					return undefined;
				});
			},
		},
	],
});
if (!result.success) throw new Error(result.logs.map(String).join("\n"));
assert.equal(result.outputs.length, 1);
for (const file of files.values())
	assert.equal(
		sha(await readFile(file.path)),
		file.sha256,
		`After build changed: ${file.path}`,
	);
await writeFile(
	join(root, "closure.json"),
	JSON.stringify(
		{
			files: [...files.values()],
			external: [{ package: "opencut-wasm", path: wasmEntry }],
			bundled:
				"Bundler onLoad source bytes are hashed and supplied from the same buffer with the actual loader; rechecked after build. External modules and runtime dynamic imports are not an asserted transitive closure.",
		},
		null,
		2,
	),
	{ flag: "wx" },
);

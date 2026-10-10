import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createPrivateEffectInputs } from "./private-effect-inputs.mjs";

const [workspace, pkg, root, creator, configPath] = process.argv.slice(2);
assert.equal(
	process.argv.length,
	7,
	"Expected workspace pkg root creator configPath",
);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const inputs = await createPrivateEffectInputs(root);
const dynamic = await inputs.captureGroup([
	creator,
	join(dirname(creator), "spatial.mjs"),
]);
const privateCreator = dynamic[0].file.path;
const privateConfig = await inputs.capture(configPath);
const frozen = [];
for (const path of [
	fileURLToPath(import.meta.url),
	join(dirname(fileURLToPath(import.meta.url)), "private-effect-inputs.mjs"),
])
	frozen.push((await inputs.capture(path)).file);
const pinned = [
	...dynamic.map((item) => item.file),
	privateConfig.file,
	...frozen,
];
for (const name of [
	"opencut_wasm_sync.js",
	"opencut_wasm_bg.js",
	"opencut_wasm_bg.wasm",
	"package.json",
])
	pinned.push(await inputs.pinBinary(join(pkg, name)));
const config = JSON.parse(privateConfig.text());
assert.equal(
	pinned.find((file) => file.path.endsWith(".wasm")).sha256,
	config.wasmSha256 ||
		"75ef560f97061951ca38a6579fb30018daeed35f782c2c1fcc492fc6cd39b8fe",
);
const files = new Map(),
	entry = join(root, "editor-entry.ts");
await writeFile(
	entry,
	`import { startHost } from ${JSON.stringify(join(workspace, "apps/cli/src/host.ts"))};
import { TargetRegistry } from ${JSON.stringify(join(workspace, "apps/cli/src/target-registry.ts"))};
import { run } from ${JSON.stringify(join(workspace, "script/fixtures/frost-editor-host.mjs"))};
await run({ startHost, TargetRegistry, root: ${JSON.stringify(root)}, creator: ${JSON.stringify(privateCreator)}, configPath: ${JSON.stringify(privateConfig.file.path)} });\n`,
	{ flag: "wx" },
);
const wasmEntry = join(pkg, "opencut_wasm_sync.js");
const result = await Bun.build({
	entrypoints: [entry],
	target: "bun",
	outdir: root,
	naming: "editor-host.mjs",
	plugins: [
		{
			name: "private-wasm-source-buffer-pin",
			setup(build) {
				build.onResolve({ filter: /^opencut-wasm$/ }, () => ({
					path: wasmEntry,
					external: true,
				}));
				build.onLoad({ filter: /./ }, async ({ path, namespace, loader }) => {
					if (path.startsWith("bun:")) return undefined;
					assert.equal(namespace, "file");
					assert.equal(typeof loader, "string");
					const captured = await inputs.capture(path, { loader });
					const original = resolve(path),
						file = captured.file;
					if (files.has(original))
						assert.equal(files.get(original).sha256, file.sha256);
					files.set(original, file);
					return { contents: captured.bytes, loader };
				});
			},
		},
	],
});
assert(result.success, result.logs.map(String).join("\n"));
assert.equal(result.outputs.length, 1);
let inputValidation;
try {
	inputValidation = await inputs.verify([...pinned, ...files.values()]);
} catch (error) {
	// Bun's default error printer collapses nested issue objects. Preserve the
	// complete failure before rethrowing; no source buffers/config contents.
	await writeFile(
		join(root, "bundle-input-validation-failure.json"),
		JSON.stringify(
			{
				...error.receipt,
				phase: "postbuild-input-validation",
				sourceSnapshot: inputs.evidence(),
				files: [...files.values()],
				pinned,
			},
			null,
			2,
		) + "\n",
		{ flag: "wx" },
	);
	throw error;
}
const outputPath = join(root, "editor-host.mjs"),
	outputBytes = await readFile(outputPath);
pinned.push({
	path: outputPath,
	sha256: sha(outputBytes),
	bytes: outputBytes.length,
});
await writeFile(
	join(root, "editor-closure.json"),
	JSON.stringify(
		{
			files: [...files.values()],
			pinned,
			privateCreator,
			privateConfig: privateConfig.file.path,
			inputValidation,
			sourceSnapshot: inputs.evidence(),
			external: [{ package: "opencut-wasm", path: wasmEntry }],
			pinScope:
				"Actual Bun onLoad same-buffer private text snapshots plus enumerated Creator/spatial/config snapshots; runtime imports private helpers only. Private WASM and emitted bundle directly pinned; not a complete transitive external/dynamic-import closure.",
		},
		null,
		2,
	),
	{ flag: "wx" },
);

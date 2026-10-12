import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const workspace = fileURLToPath(new URL("../..", import.meta.url));
const old = join(workspace, ".artifacts/three-toolchain/run-3Hn5Nw");
const archive =
	"C:/tmps/three-assets-production-20261011/elftia-three-assets-0.1.1.tgz";
const pkg = "C:/tmps/rocut-svg-wasm-DHuXQ7/pkg";
const root = await mkdtemp("C:/tmps/rocut-three-pinned-features-");
const toolchain = join(root, "toolchain");
const hash = (
	bytes: Uint8Array,
	algorithm = "sha256",
	encoding: "hex" | "base64" = "hex",
) => createHash(algorithm).update(bytes).digest(encoding);
const bytes = await readFile(archive);
assert.equal(hash(bytes, "sha1"), "33fc5da92949a6769975fac65e816986653d1374");
await mkdir(toolchain);
for (const name of ["three", "esbuild", "@noble/hashes", "@esbuild/win32-x64"])
	await cp(
		join(old, "node_modules", name),
		join(toolchain, "node_modules", name),
		{ recursive: true, dereference: true, errorOnExist: true, force: false },
	);
const entries = execFileSync("tar", ["-tf", archive], {
	encoding: "utf8",
	windowsHide: true,
})
	.trim()
	.split(/\r?\n/);
assert(
	entries.every(
		(entry) =>
			entry.startsWith("package/") &&
			!entry.split("/").includes("..") &&
			!entry.includes("\\"),
	),
	"Unsafe package archive entry",
);
const assetRoot = join(toolchain, "node_modules/@elftia/three-assets");
await mkdir(assetRoot, { recursive: true });
execFileSync("tar", ["-xf", archive, "-C", assetRoot, "--strip-components=1"], {
	windowsHide: true,
});
const originalLock = await readFile(join(old, "package-lock.json"));
const lock = JSON.parse(originalLock.toString("utf8"));
const asset = lock.packages["node_modules/@elftia/three-assets"];
assert.equal(asset.version, "0.1.1");
asset.resolved = pathToFileURL(archive).href;
asset.integrity = `sha512-${hash(bytes, "sha512", "base64")}`;
lock.packages[""].dependencies["@elftia/three-assets"] = asset.resolved;
await writeFile(
	join(toolchain, "package-lock.json"),
	JSON.stringify(lock, null, 2),
	{ flag: "wx" },
);
const manifest = JSON.parse(
	(await readFile(join(old, "package.json"))).toString("utf8"),
);
manifest.dependencies["@elftia/three-assets"] = asset.resolved;
await writeFile(
	join(toolchain, "package.json"),
	JSON.stringify(manifest, null, 2),
	{ flag: "wx" },
);
const newManifest = JSON.parse(
	(await readFile(join(assetRoot, "package.json"))).toString("utf8"),
);
assert.equal(newManifest.elftiaAssetFeatures, "svg-animation-v1");
assert.equal(newManifest.elftiaAssetCodecs, "offline-codecs-v1");
await writeFile(
	join(root, "closure-receipt.json"),
	JSON.stringify(
		{
			root,
			toolchain,
			pkg,
			archive,
			archiveSha1: hash(bytes, "sha1"),
			archiveIntegrity: asset.integrity,
			originalLockSha256: hash(originalLock),
			dependencySource: old,
			policy:
				"Only the asset archive entry changes; registry dependency version/integrity pins are retained. Existing dependency bytes copied; no package installation/download.",
		},
		null,
		2,
	),
	{ flag: "wx" },
);
const output = join(root, "compile.mjs");
const built = await Bun.build({
	entrypoints: [
		join(workspace, "script/fixtures/three-feature-pinned-compile-worker.ts"),
	],
	outdir: root,
	naming: "compile.mjs",
	target: "bun",
	plugins: [
		{
			name: "private-real-wasm",
			setup(builder) {
				builder.onResolve({ filter: /^opencut-wasm$/ }, () => ({
					path: join(pkg, "opencut_wasm_sync.js"),
					external: true,
				}));
			},
		},
	],
});
assert(built.success, built.logs.map(String).join("\n"));
const { run } = await import(pathToFileURL(output).href);
await run({ root, toolchain });
console.log(
	JSON.stringify({
		root,
		toolchain,
		passed: true,
		scope:
			"complete compileProgrammaticProject archive/rebuild; no GPU/installed runtime",
	}),
);

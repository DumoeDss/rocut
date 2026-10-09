import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { THREE_TOOLCHAIN } from "../apps/cli/src/programmatic/engines/engine-versions.ts";

// Explicit fixture preparation only. Runtime compile/rebuild never downloads packages.
if (process.argv.length !== 3)
	throw Error(
		"Usage: node script/prepare-three-toolchain.mjs /absolute/shared-package.tgz",
	);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const archive = await realpath(process.argv[2]);
if (!archive.endsWith(".tgz"))
	throw Error("Expected a locally built shared-package archive");
const parent = join(root, ".artifacts", "three-toolchain");
await mkdir(parent, { recursive: true });
const target = await mkdtemp(join(parent, "run-"));
await writeFile(
	join(target, "package.json"),
	JSON.stringify(
		{
			name: "rocut-three-toolchain-fixture",
			private: true,
			version: "1.0.0",
			type: "module",
			dependencies: {
				...THREE_TOOLCHAIN,
				"@elftia/three-assets": `file:${archive.replaceAll("\\", "/")}`,
			},
		},
		null,
		2,
	) + "\n",
	{ encoding: "utf8", flag: "wx" },
);
const npm = join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
await promisify(execFile)(
	process.execPath,
	[npm, "install", "--ignore-scripts", "--no-audit", "--no-fund"],
	{
		cwd: target,
		windowsHide: true,
		timeout: 180000,
		maxBuffer: 2 * 1024 * 1024,
	},
);
const manifest = JSON.parse(
	await readFile(
		join(target, "node_modules/@elftia/three-assets/package.json"),
		"utf8",
	),
);
if (manifest.version !== THREE_TOOLCHAIN["@elftia/three-assets"])
	throw Error("Shared package version differs from controlled toolchain");
console.log(
	JSON.stringify({
		toolchainDirectory: target,
		archiveSha256: createHash("sha256")
			.update(await readFile(archive))
			.digest("hex"),
		versions: THREE_TOOLCHAIN,
	}),
);

#!/usr/bin/env node
// --pkg-dir <absolute-directory>; omitted selects the current rust/wasm/pkg.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isInvokedScript, packageDirectoryArguments } from "./wasm-package-directory.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export function contractCompilerConfig(pkgDir) {
	return {
		compilerOptions: {
			noEmit: true,
			strict: true,
			skipLibCheck: true,
			target: "ES2022",
			module: "ESNext",
			moduleResolution: "Bundler",
			lib: ["ES2022", "DOM", "ESNext.Disposable"],
			// Never resolve a stale node_modules/opencut-wasm copy. Absolute
			// paths stay bound to this artifact even though the config is temporary.
			paths: { "opencut-wasm": [join(pkgDir, "opencut_wasm.d.ts")] },
		},
		files: [join(ROOT, "script", "fixtures", "wasm-runtime-contract.ts")],
	};
}

export function runContract(argv, run = spawnSync) {
	const { pkgDir, remaining } = packageDirectoryArguments(argv, "--pkg-dir", ROOT);
	if (remaining.length) throw Error(`Unknown arguments: ${remaining.join(" ")}`);
	if (!existsSync(join(pkgDir, "opencut_wasm.d.ts"))) {
		throw Error(`Missing package declarations: ${join(pkgDir, "opencut_wasm.d.ts")}`);
	}
	const temporary = mkdtempSync(join(tmpdir(), "rocut-wasm-contract-"));
	const config = join(temporary, "tsconfig.json");
	try {
		writeFileSync(config, JSON.stringify(contractCompilerConfig(pkgDir), null, 2), { encoding: "utf8", flag: "wx" });
		const result = run(process.execPath, [
			join(ROOT, "node_modules", "typescript", "bin", "tsc"),
			"--project", config,
		], { cwd: ROOT, encoding: "utf8" });
		if (result.status !== 0) {
			console.error(`${result.error?.message ?? ""}${result.stdout ?? ""}${result.stderr ?? ""}`);
		}
		return result.status ?? 1;
	} finally {
		// Only the exact file and freshly created empty directory; no recursive cleanup.
		if (existsSync(config)) unlinkSync(config);
		rmdirSync(temporary);
	}
}

if (isInvokedScript(import.meta.url)) {
	try { process.exitCode = runContract(process.argv.slice(2)); }
	catch (error) { console.error(`structural-compile: ${error.message}`); process.exitCode = 2; }
}

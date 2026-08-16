/**
 * Proves the two resolution claims the `exports` map rests on:
 *
 *   1. `"./*": "./*"` preserves every path that resolved inside `opencut-wasm` before the map
 *      existed — adding `exports` otherwise seals them, and the init gate's negative control
 *      imports the bundler entry by name.
 *   2. No `require` condition is needed. Node's `default` is a catch-all, so
 *      `createRequire(...).resolve("opencut-wasm")` — which `script/check-wasm-source.mjs` calls
 *      once per Host — still resolves instead of throwing ERR_PACKAGE_PATH_NOT_EXPORTED.
 *
 *   node rasen/changes/wasm-determinism-init/evidence/exports-map-resolution.mjs
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const require = createRequire(join(ROOT, "package.json"));

const shorten = (path) => path.split(/node_modules[\\/]/).pop();
let failures = 0;

console.log("require.resolve (the CJS path check-wasm-source.mjs uses):");
for (const specifier of [
	"opencut-wasm",
	"opencut-wasm/sync",
	"opencut-wasm/opencut_wasm.js",
	"opencut-wasm/opencut_wasm_bg.js",
	"opencut-wasm/opencut_wasm_bg.wasm",
	"opencut-wasm/opencut_wasm.d.ts",
	"opencut-wasm/package.json",
]) {
	try {
		console.log(`  PASS  ${specifier.padEnd(34)} -> ${shorten(require.resolve(specifier))}`);
	} catch (error) {
		failures += 1;
		console.log(`  FAIL  ${specifier.padEnd(34)} -> ${error.code ?? error.message}`);
	}
}

console.log("\nimport.meta.resolve (the ESM path consumers use):");
for (const specifier of [
	"opencut-wasm",
	"opencut-wasm/sync",
	"opencut-wasm/opencut_wasm.js",
	"opencut-wasm/opencut_wasm_bg.wasm",
]) {
	try {
		console.log(`  PASS  ${specifier.padEnd(34)} -> ${shorten(import.meta.resolve(specifier))}`);
	} catch (error) {
		failures += 1;
		console.log(`  FAIL  ${specifier.padEnd(34)} -> ${error.code ?? error.message}`);
	}
}

console.log(
	`\n${failures === 0 ? "clean" : "FAILED"} — 11 specifier(s) checked, ${failures} unresolvable`,
);
process.exit(failures === 0 ? 0 : 1);

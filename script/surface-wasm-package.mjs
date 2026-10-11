import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { assertRuntimeWasmPackageUnchanged, resolveRuntimeWasmPackage } from "./runtime-wasm-package-closure.mjs";

export const SURFACE_WASM_RECEIPT = "surface-wasm-package.json";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");

export function assertUnredirectedPath(path) {
	if (typeof path !== "string" || !isAbsolute(path)) throw Error("Surface path requires an absolute path");
	for (let current = resolve(path); ; current = dirname(current)) {
		if (existsSync(current) && (lstatSync(current).isSymbolicLink() ||
			realpathSync.native(current).toLowerCase() !== current.toLowerCase()))
			throw Error(`Surface path is redirected: ${current}`);
		if (dirname(current) === current) break;
	}
}

export function assertDisjointPaths(input, output) {
	assertUnredirectedPath(input);
	assertUnredirectedPath(output);
	const overlaps = (a, b) => { const rel = relative(a, b); return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel)); };
	if (overlaps(input, output) || overlaps(output, input)) throw Error("Surface input/output paths overlap");
}

/** CLI receipt output must never overwrite explicitly selected build inputs. */
export function assertRuntimeManifestOutsideInputs({ manifestPath, wasmPackageDirectory, surfaceDirectory }) {
	for (const input of [wasmPackageDirectory, surfaceDirectory]) {
		if (input !== undefined) assertDisjointPaths(input, manifestPath);
	}
}

export function resolveSurfaceWasmPackage({ repoRoot, wasmPackageDirectory, outDir }) {
	assertDisjointPaths(wasmPackageDirectory, outDir);
	const closure = resolveRuntimeWasmPackage({ repoRoot, wasmPackageDirectory });
	const entry = join(wasmPackageDirectory, "opencut_wasm.js");
	const bytes = readFileSync(entry);
	const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	const manifest = JSON.parse(readFileSync(join(wasmPackageDirectory, "package.json"), "utf8"));
	if (manifest.exports?.["."]?.default !== "./opencut_wasm.js" ||
		!/import\s+\*\s+as\s+wasm\s+from\s*["']\.\/opencut_wasm_bg\.wasm["']/.test(source) ||
		!/from\s*["']\.\/opencut_wasm_bg\.js["']/.test(source) ||
		!/\bwasm\.__wbindgen_start\(\)/.test(source))
		throw Error("Selected surface package must declare its fixed bundler closure");
	const glue = new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(join(wasmPackageDirectory, "opencut_wasm_bg.js")));
	const glueExports = new Set([...glue.matchAll(/export\s+(?:function|const|let|var|class)\s+(\w+)/g)].map(match => match[1]));
	const reexports = source.match(/export\s*\{([^}]+)\}\s*from\s*["']\.\/opencut_wasm_bg\.js["']/);
	if (!reexports || reexports[1].split(",").some(name => !glueExports.has(name.trim())))
		throw Error("Selected surface bundler entry exports incompatible glue");
	if (!WebAssembly.Module.exports(new WebAssembly.Module(readFileSync(closure.wasmBinary))).some(item => item.name === "__wbindgen_start"))
		throw Error("Selected surface WASM lacks its bundler start export");
	return { ...closure, wasmBundlerEntry: entry, bundlerEntrySha256: hash(bytes) };
}

export function surfaceWasmPackagePlugin(closure) {
	return {
		name: "rocut-selected-surface-wasm",
		apply: "build",
		generateBundle(_options, bundle) {
			assertRuntimeWasmPackageUnchanged(closure);
			if (hash(readFileSync(closure.wasmBundlerEntry)) !== closure.bundlerEntrySha256)
				throw Error("Selected surface bundler entry changed");
			const expected = closure.files.find(file => file.name.endsWith(".wasm")).sha256;
			const emitted = Object.values(bundle).filter(item => item.type === "asset" &&
				item.fileName.endsWith(".wasm") && hash(item.source) === expected);
			if (emitted.length !== 1) throw Error("Selected core WASM must be emitted exactly once");
			this.emitFile({ type: "asset", fileName: SURFACE_WASM_RECEIPT,
				source: JSON.stringify({ wasmPackage: closure,
					coreWasm: { path: emitted[0].fileName, sha256: expected } }, null, 2) + "\n" });
		},
	};
}

export function verifySurfaceWasmPackage({ surfaceDirectory, outDir, wasmPackage }) {
	assertDisjointPaths(surfaceDirectory, outDir);
	const receipt = JSON.parse(readFileSync(join(surfaceDirectory, SURFACE_WASM_RECEIPT), "utf8"));
	const path = receipt.coreWasm?.path;
	if (typeof path !== "string" || isAbsolute(path) || path.includes("\\") ||
		path.split("/").some(part => !part || part === "." || part === "..") || !path.endsWith(".wasm"))
		throw Error("Invalid surface core WASM path");
	const binary = join(surfaceDirectory, path);
	assertUnredirectedPath(binary);
	const actual = hash(readFileSync(binary));
	const expected = wasmPackage.files.find(file => file.name.endsWith(".wasm")).sha256;
	if (actual !== expected || receipt.coreWasm.sha256 !== actual ||
		JSON.stringify(receipt.wasmPackage?.files) !== JSON.stringify(wasmPackage.files))
		throw Error("Surface core WASM does not match selected runtime package bytes");
	return { receipt: SURFACE_WASM_RECEIPT, coreWasm: { path, sha256: actual } };
}

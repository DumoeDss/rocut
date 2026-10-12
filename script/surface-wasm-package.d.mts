import type { Plugin } from "vite";

export interface RuntimeWasmPackageClosure {
	wasmPackageDirectory: string;
	selection: "canonical" | "explicit";
	wasmSyncEntry: string;
	wasmBinary: string;
	packageManifestSha256: string;
	files: Array<{ name: string; bytes: number; sha256: string }>;
}

export interface SurfaceWasmPackageClosure extends RuntimeWasmPackageClosure {
	wasmBundlerEntry: string;
	bundlerEntrySha256: string;
}

export const SURFACE_WASM_RECEIPT: "surface-wasm-package.json";
export function assertUnredirectedPath(path: string): void;
export function assertDisjointPaths(input: string, output: string): void;
export function assertRuntimeManifestOutsideInputs(options: {
	manifestPath: string;
	wasmPackageDirectory?: string;
	surfaceDirectory?: string;
}): void;
export function resolveSurfaceWasmPackage(options: {
	repoRoot: string;
	wasmPackageDirectory: string;
	outDir: string;
}): SurfaceWasmPackageClosure;
export function surfaceWasmPackagePlugin(closure: SurfaceWasmPackageClosure): Plugin;
export function verifySurfaceWasmPackage(options: {
	surfaceDirectory: string;
	outDir: string;
	wasmPackage: RuntimeWasmPackageClosure;
}): { receipt: string; coreWasm: { path: string; sha256: string } };

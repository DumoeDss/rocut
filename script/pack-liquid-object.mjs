import { build } from "esbuild";
import { lstatSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

export const LIQUID_OBJECT_WASM_MODULE = "liquid-object-wasm.mjs";
export const LIQUID_OBJECT_WORKER_ENTRY = "liquid-object-worker-entry.mjs";
export const liquidObjectDefine = Object.freeze({
	"import.meta.__ROCUT_PACKED_LIQUID_OBJECT_MODULE_V1__": JSON.stringify(
		`./${LIQUID_OBJECT_WASM_MODULE}`,
	),
});

function outputIdentity(outDir) {
	const stat = lstatSync(outDir, { bigint: true });
	if (
		!stat.isDirectory() ||
		stat.isSymbolicLink() ||
		resolve(realpathSync(outDir)) !== resolve(outDir)
	) {
		throw Error(
			"Liquid pack output must be an existing non-redirected directory",
		);
	}
	return `${stat.dev}:${stat.ino}:${stat.birthtimeNs}`;
}

/** Fixed sidecars only; the main packer owns the shared WASM binary.
 * Exclusive writes never overwrite, delete or roll back a replaced tree.
 * Export metadata is a build gate; actual worker execution is tested separately.
 */
export async function buildLiquidObjectAssets({
	repoRoot,
	outDir,
	wasmSyncEntry,
}) {
	if (
		![repoRoot, outDir, wasmSyncEntry].every(
			(value) => typeof value === "string" && isAbsolute(value),
		)
	)
		throw Error("Liquid pack requires explicit absolute host-owned paths");
	const identity = outputIdentity(outDir);
	const verifyOutput = () => {
		if (outputIdentity(outDir) !== identity) {
			throw Error("Liquid pack output directory identity changed during build");
		}
	};
	const worker = readFileSync(
		join(repoRoot, "apps/cli/src/programmatic", LIQUID_OBJECT_WORKER_ENTRY),
	);
	const result = await build({
		absWorkingDir: repoRoot,
		entryPoints: [wasmSyncEntry],
		outfile: join(outDir, LIQUID_OBJECT_WASM_MODULE),
		bundle: true,
		platform: "node",
		format: "esm",
		target: "es2022",
		external: ["*.wasm"],
		write: false,
		metafile: true,
		logLevel: "silent",
		sourcemap: false,
	});
	const files = result.outputFiles;
	if (
		files.length !== 1 ||
		!Object.values(result.metafile.outputs).some((output) =>
			[
				"LiquidObjectTransportOwner",
				"liquidObjectTransportPolicyJson",
				"evaluateLiquidObjectFrameJson",
			].every((name) => output.exports.includes(name)),
		) ||
		!files[0].text.includes("opencut_wasm_bg.wasm")
	) {
		throw Error(
			"Liquid pack requires the sync WASM sibling loader, owner, evaluator and transport policy exports",
		);
	}
	verifyOutput();
	writeFileSync(join(outDir, LIQUID_OBJECT_WASM_MODULE), files[0].contents, {
		flag: "wx",
	});
	verifyOutput();
	writeFileSync(join(outDir, LIQUID_OBJECT_WORKER_ENTRY), worker, {
		flag: "wx",
	});
	return {
		files: [LIQUID_OBJECT_WASM_MODULE, LIQUID_OBJECT_WORKER_ENTRY],
		metafile: result.metafile,
	};
}

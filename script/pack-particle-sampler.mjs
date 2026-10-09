import { build } from "esbuild";
import { lstatSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

export const PARTICLE_SAMPLER_WASM_MODULE = "particle-sampler-wasm.mjs";
export const PARTICLE_SAMPLER_WORKER_ENTRY =
	"particle-sampler-worker-entry.mjs";
export const particleSamplerDefine = Object.freeze({
	"import.meta.__ROCUT_PACKED_PARTICLE_SAMPLER_MODULE_V1__": JSON.stringify(
		`./${PARTICLE_SAMPLER_WASM_MODULE}`,
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
			"Particle pack output must be an existing non-redirected directory",
		);
	}
	return `${stat.dev}:${stat.ino}:${stat.birthtimeNs}`;
}

/** Emits only fixed sidecars. The main packer's placeWasmSibling owns the one
 * shared opencut_wasm_bg.wasm copy, inventory and determinism comparison.
 * Targets are exclusive new files: this helper never deletes/overwrites output.
 */
export async function buildParticleSamplerAssets({
	repoRoot,
	outDir,
	wasmSyncEntry,
}) {
	if (
		![repoRoot, outDir, wasmSyncEntry].every(
			(value) => typeof value === "string" && isAbsolute(value),
		)
	) {
		throw Error("Particle pack requires explicit absolute host-owned paths");
	}
	const identity = outputIdentity(outDir);
	const verifyOutput = () => {
		if (outputIdentity(outDir) !== identity) {
			throw Error(
				"Particle pack output directory identity changed during build",
			);
		}
	};
	const worker = readFileSync(
		join(repoRoot, "apps/cli/src/programmatic", PARTICLE_SAMPLER_WORKER_ENTRY),
	);
	const result = await build({
		absWorkingDir: repoRoot,
		entryPoints: [wasmSyncEntry],
		outfile: join(outDir, PARTICLE_SAMPLER_WASM_MODULE),
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
			["sampleParticleSurfaceJson", "particleTransportPolicyJson"].every(
				(name) => output.exports.includes(name),
			),
		) ||
		!files[0].text.includes("opencut_wasm_bg.wasm")
	) {
		throw Error(
			"Particle pack requires the sync WASM sibling loader, surface and transport policy exports",
		);
	}
	// esbuild yields to other work: revalidate the actual directory, not just
	// the spelling of its path. No rollback/cleanup targets a replaced tree.
	verifyOutput();
	writeFileSync(join(outDir, PARTICLE_SAMPLER_WASM_MODULE), files[0].contents, {
		flag: "wx",
	});
	verifyOutput();
	writeFileSync(join(outDir, PARTICLE_SAMPLER_WORKER_ENTRY), worker, {
		flag: "wx",
	});
	return {
		files: [PARTICLE_SAMPLER_WASM_MODULE, PARTICLE_SAMPLER_WORKER_ENTRY],
		metafile: result.metafile,
	};
}

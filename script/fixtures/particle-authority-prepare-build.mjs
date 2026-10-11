import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { stageParticleAuthority } from "./particle-editor-export-authority-stage.mjs";
import { writeParticleCompileBootstrap } from "./particle-authority-compile-context.mjs";
import { hash, plain, writeJson } from "../particle-c4-export-support.mjs";
import { readParticleAuthoredRecipe } from "./particle-authority-authored-recipe.mjs";

export async function prepareParticleAuthorityCompile({
	repo,
	root,
	options,
	authority,
	sources,
}) {
	// Repeat the independent raw pin before staging, copying or building.
	const recipe = readParticleAuthoredRecipe(options["creator-root"]);
	assert.deepEqual(
		recipe.contract,
		options.authoredRecipe,
		"Creator recipe changed after parsing",
	);
	const remember = async (path) => {
		const bytes = await readFile(path),
			entry = { path: resolve(path), bytes: bytes.length, sha256: hash(bytes) };
		if (sources.has(entry.path))
			assert.deepEqual(
				entry,
				sources.get(entry.path),
				"Compile source changed",
			);
		sources.set(entry.path, entry);
		return bytes;
	};
	for (const file of recipe.files) {
		await plain(file.path, false);
		assert.deepEqual(
			await remember(file.path),
			file.bytes,
			"Creator recipe changed before copy",
		);
	}
	const { wasmSync } = await stageParticleAuthority({
		authority,
		root,
		remember,
	});
	await writeJson(join(root, "authored-recipe-contract.json"), recipe.contract);
	await mkdir(join(root, "author"));
	for (const { output, bytes } of recipe.files) {
		await writeFile(join(root, output), bytes, { flag: "wx" });
		assert.deepEqual(await remember(join(root, output)), bytes);
	}
	await remember(join(root, "authored-recipe-contract.json"));
	for (const path of [
		"script/probe-particle-authority-prepare.mjs",
		"script/probe-child-lifecycle.mjs",
		"script/particle-c4-export-support.mjs",
		...[
			"compile-context",
			"prepare-contract",
			"prepare-build",
			"authored-recipe",
		].map((name) => "script/fixtures/particle-authority-" + name + ".mjs"),
		...[
			"authority",
			"authority-identity",
			"authority-stage",
			"authority-browser",
		].map((name) => "script/fixtures/particle-editor-export-" + name + ".mjs"),
	])
		await remember(join(repo, path));
	await remember(join(root, "particle-compile-authority-context.json"));
	const body = join(root, "host-body.mjs");
	const result = await build({
		absWorkingDir: repo,
		entryPoints: [
			join(repo, "script/fixtures/particle-authority-compile-host.ts"),
		],
		outfile: body,
		bundle: true,
		platform: "node",
		format: "esm",
		target: "es2022",
		write: false,
		metafile: true,
		define: {
			"import.meta.__ROCUT_PACKED_PARTICLE_SAMPLER_MODULE_V1__": JSON.stringify(
				"./particle-sampler-wasm.mjs",
			),
		},
		plugins: [
			{
				name: "particle-authority-private-compile",
				setup(api) {
					api.onResolve({ filter: /^opencut-wasm(?:\/sync)?$/ }, () => ({
						path: pathToFileURL(wasmSync).href,
						external: true,
					}));
					api.onResolve({ filter: /^node:child_process$/ }, ({ importer }) =>
						importer.endsWith("particle-c2-process-observer.mjs")
							? { path: "node:child_process", external: true }
							: {
									path: join(
										repo,
										"script/fixtures/particle-c2-process-observer.mjs",
									),
								},
					);
					api.onLoad(
						{ filter: /\.(?:ts|tsx|js|mjs|json)$/ },
						async ({ path }) => ({
							contents: new TextDecoder("utf8", { fatal: true }).decode(
								await remember(path),
							),
							loader:
								{ ".ts": "ts", ".tsx": "tsx", ".json": "json" }[
									extname(path)
								] ?? "js",
							resolveDir: dirname(path),
						}),
					);
				},
			},
		],
	});
	assert.equal(result.outputFiles.length, 1);
	await writeFile(body, result.outputFiles[0].contents, { flag: "wx" });
	await remember(body);
	await writeParticleCompileBootstrap({ root, authority, remember });
	await writeJson(join(root, "compile-host-metafile.json"), result.metafile);
	await writeJson(join(root, "compile-source-manifest.json"), {
		sources: [...sources.values()],
		warnings: result.warnings,
	});
	await authority.assertUnchanged();
}

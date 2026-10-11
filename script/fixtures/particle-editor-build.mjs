import assert from "node:assert/strict";
import { constants } from "node:fs";
import { copyFile, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build as buildHost } from "esbuild";
import { build as buildBrowser } from "../browser-probe-toolchain.mjs";
import {
	hash,
	treeManifest,
	writeJson,
} from "../particle-c4-export-support.mjs";
import { frozenParticleFiles } from "./particle-editor-contract.mjs";
import {
	stageParticleAuthority,
	writeParticleAuthorityBootstrap,
} from "./particle-editor-export-authority-stage.mjs";

export async function buildParticleEditor({
	repo,
	root,
	options,
	sources,
	authority,
}) {
	async function remember(path) {
		const bytes = await readFile(path),
			entry = { path: resolve(path), bytes: bytes.length, sha256: hash(bytes) };
		if (sources.has(entry.path))
			assert.deepEqual(
				entry,
				sources.get(entry.path),
				"Build input changed during preparation",
			);
		sources.set(entry.path, entry);
		return bytes;
	}
	let syncEntry = options["wasm-sync"],
		bundlerEntry = join(dirname(syncEntry), "opencut_wasm.js");
	if (authority) {
		({ wasmSync: syncEntry, bundlerEntry } = await stageParticleAuthority({
			authority,
			root,
			remember,
		}));
	} else {
		const wasmDirectory = dirname(syncEntry);
		assert.equal(
			hash(await remember(join(wasmDirectory, "opencut_wasm_bg.wasm"))),
			frozenParticleFiles["opencut_wasm_bg.wasm"],
		);
		for (const [name, digest] of Object.entries(frozenParticleFiles)) {
			assert.equal(
				hash(await remember(join(options["sampler-dir"], name))),
				digest,
				`Frozen C3 sidecar required: ${name}`,
			);
			await copyFile(
				join(options["sampler-dir"], name),
				join(root, name),
				constants.COPYFILE_EXCL,
			);
			assert.equal(hash(await remember(join(root, name))), digest);
		}
	}
	for (const path of [
		"script/probe-particle-editor.mjs",
		"script/fixtures/particle-editor-contract.mjs",
		"script/fixtures/particle-editor-build.mjs",
		"script/fixtures/particle-editor-checks.mjs",
		"script/fixtures/particle-editor-validate.mjs",
		"script/fixtures/particle-editor-contract.test.mjs",
		"script/fixtures/particle-editor-credentials.mjs",
		"script/fixtures/particle-editor-credentials.test.mjs",
		"script/fixtures/particle-editor-references.mjs",
		"script/fixtures/particle-editor-frozen-preload.mjs",
		"packages/editor-classic/src/preview/hooks/__tests__/use-transform-handles.test.tsx",
		"script/fixtures/stylized-fusion-checks.mjs",
		"script/fixtures/stylized-fusion-visuals.mjs",
		"script/fixtures/sweep-scroll-editor-history.mjs",
		"script/particle-c4-export-support.mjs",
		"script/probe-child-lifecycle.mjs",
		"script/browser-probe-toolchain.mjs",
		"apps/vite-example/vite.config.ts",
		"apps/vite-example/build/editor-assets.ts",
		"apps/vite-example/build/module-graph.ts",
	])
		await remember(join(repo, path));
	for (const path of [
		syncEntry,
		bundlerEntry,
		join(dirname(syncEntry), "opencut_wasm_bg.js"),
		join(options.toolchain, "package-lock.json"),
	])
		await remember(path);
	if (authority) {
		for (const name of [
			"authority",
			"authority-identity",
			"authority-stage",
			"authority-browser",
		])
			await remember(
				join(repo, `script/fixtures/particle-editor-export-${name}.mjs`),
			);
		for (const name of [
			"particle-editor-authority-references.mjs",
			"particle-editor-integer-geometry.mjs",
		])
			await remember(join(repo, "script/fixtures", name));
		await remember(join(root, "particle-authority-context.json"));
	}
	const hostOutput = join(root, authority ? "host-body.mjs" : "host.mjs");
	const bundled = await buildHost({
		absWorkingDir: repo,
		entryPoints: [join(repo, "script/fixtures/particle-editor-host.ts")],
		outfile: hostOutput,
		metafile: Boolean(authority),
		bundle: true,
		platform: "node",
		format: "esm",
		target: "es2022",
		write: false,
		define: {
			"import.meta.__ROCUT_PACKED_PARTICLE_SAMPLER_MODULE_V1__": JSON.stringify(
				"./particle-sampler-wasm.mjs",
			),
		},
		plugins: [
			{
				name: "particle-editor-private-host",
				setup(api) {
					api.onResolve({ filter: /^opencut-wasm(?:\/sync)?$/ }, () => ({
						path: pathToFileURL(syncEntry).href,
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
							contents: new TextDecoder("utf-8", { fatal: true }).decode(
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
	assert.equal(bundled.outputFiles.length, 1);
	await writeFile(hostOutput, bundled.outputFiles[0].contents, {
		flag: "wx",
	});
	await remember(hostOutput);
	if (authority) {
		await writeJson(join(root, "host-build-metafile.json"), bundled.metafile);
		await writeParticleAuthorityBootstrap({ root, authority, remember });
	}
	const generatedModules = new Map(),
		warnings = [];
	await buildBrowser({
		root: join(repo, "apps/vite-example"),
		configFile: join(repo, "apps/vite-example/vite.config.ts"),
		configLoader: "runner",
		base: "./",
		envDir: root,
		envPrefix: "ROCUT_PARTICLE_EDITOR_PUBLIC_",
		cacheDir: join(root, "vite-cache"),
		logLevel: "error",
		resolve: {
			alias: { "opencut-wasm": bundlerEntry },
		},
		plugins: [
			{
				name: "particle-editor-source-manifest",
				async transform(code, id) {
					const path = id.split("?")[0];
					if (id === "/__vite-plugin-wasm-helper")
						generatedModules.set(id, {
							id,
							sha256: hash(code),
							bytes: Buffer.byteLength(code),
						});
					else if (isAbsolute(path) && !path.includes("\0"))
						await remember(path);
					return null;
				},
			},
		],
		build: {
			outDir: join(root, "editor"),
			emptyOutDir: false,
			rollupOptions: {
				onwarn(warning) {
					warnings.push({ code: warning.code, message: warning.message });
				},
			},
		},
	});
	const wasmFiles = (await readdir(join(root, "editor/assets"))).filter(
		(name) => name.startsWith("opencut_wasm_bg-") && name.endsWith(".wasm"),
	);
	assert.equal(wasmFiles.length, 1);
	assert.equal(
		hash(await readFile(join(root, "editor/assets", wasmFiles[0]))),
		authority
			? authority.metadata.nativeAuthority.wasmSha256
			: frozenParticleFiles["opencut_wasm_bg.wasm"],
	);
	if (authority) await authority.assertUnchanged();
	await writeJson(
		join(root, "browser-build-manifest.json"),
		await treeManifest(join(root, "editor")),
	);
	await writeJson(join(root, "source-manifest.json"), {
		sources: [...sources.values()],
		generatedModules: [...generatedModules.values()],
	});
	await writeJson(join(root, "build-warnings.json"), warnings);
	return {
		sourceCount: sources.size,
		browserEntry: "apps/vite-example/index.html",
		warnings: warnings.length,
	};
}

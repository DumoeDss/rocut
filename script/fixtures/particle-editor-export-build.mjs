import assert from "node:assert/strict";
import { build as buildHost } from "esbuild";
import { constants } from "node:fs";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	build as buildBrowser,
	wasm,
	topLevelAwait,
} from "../browser-probe-toolchain.mjs";
import {
	hash,
	treeManifest,
	writeJson,
} from "../particle-c4-export-support.mjs";
import {
	stageParticleAuthority,
	writeParticleAuthorityBootstrap,
} from "./particle-editor-export-authority-stage.mjs";

export async function buildEditorExport({
	repo,
	root,
	options,
	sources,
	authority,
}) {
	const generatedModules = new Map();
	async function remember(path) {
		const bytes = await readFile(path),
			entry = { path: resolve(path), bytes: bytes.length, sha256: hash(bytes) };
		if (sources.has(entry.path))
			assert.deepEqual(
				entry,
				sources.get(entry.path),
				"Source changed during build",
			);
		sources.set(entry.path, entry);
		return bytes;
	}
	let syncEntry = options["wasm-sync"],
		bundlerEntry = join(dirname(syncEntry), "opencut_wasm.js");
	const pinned = {
		"particle-sampler-wasm.mjs":
			"205eb2eff08f10677294d38a90aedceb6b65ce52c7e4ea87760b0cbac8a86c3a",
		"opencut_wasm_bg.wasm":
			"328a2a4313812c356f28d74f27cfeaa10cad3a933e2c4f3de5ded20d8d98c221",
		"particle-sampler-worker-entry.mjs":
			"e9afc00344177d72276eb6c8ba269749e8cf27644758d9c6037a59e5f7e7dd30",
	};
	if (authority) {
		({ wasmSync: syncEntry, bundlerEntry } = await stageParticleAuthority({
			authority,
			root,
			remember,
		}));
	} else {
		assert.equal(
			hash(await remember(join(dirname(syncEntry), "opencut_wasm_bg.wasm"))),
			pinned["opencut_wasm_bg.wasm"],
			"Only the frozen C3 WASM is accepted",
		);
		for (const [name, expected] of Object.entries(pinned)) {
			assert.equal(
				hash(await remember(join(options["sampler-dir"], name))),
				expected,
				`Wrong frozen C3 sampler ${name}`,
			);
			await copyFile(
				join(options["sampler-dir"], name),
				join(root, name),
				constants.COPYFILE_EXCL,
			);
			assert.equal(hash(await remember(join(root, name))), expected);
		}
	}
	for (const path of [
		fileURLToPath(import.meta.url),
		join(repo, "script/fixtures/particle-editor-export-verify.mjs"),
		join(repo, "script/fixtures/particle-editor-export-contract.mjs"),
		join(repo, "script/fixtures/particle-editor-export-contract.test.mjs"),
		join(repo, "script/fixtures/particle-editor-export-admission.test.ts"),
		join(repo, "script/fixtures/particle-project-export-pixels.mjs"),
		join(repo, "script/probe-particle-editor-export.mjs"),
		join(repo, "script/particle-c4-export-support.mjs"),
		join(repo, "script/probe-child-lifecycle.mjs"),
		join(repo, "script/browser-probe-toolchain.mjs"),
		syncEntry,
		bundlerEntry,
		join(dirname(syncEntry), "opencut_wasm_bg.js"),
		join(options.toolchain, "package-lock.json"),
	])
		await remember(path);
	if (authority) {
		for (const name of [
			"particle-editor-export-authority.mjs",
			"particle-editor-export-authority-identity.mjs",
			"particle-editor-export-authority-stage.mjs",
			"particle-editor-export-authority-browser.mjs",
		])
			await remember(join(repo, "script/fixtures", name));
		await remember(join(root, "particle-authority-context.json"));
	}
	const hostBundle = await buildHost({
		absWorkingDir: repo,
		entryPoints: [join(repo, "script/fixtures/particle-editor-export-host.ts")],
		outfile: join(root, authority ? "host-body.mjs" : "host.mjs"),
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
				name: "isolated-c4-export-host",
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
	assert.equal(hostBundle.outputFiles.length, 1);
	const hostOutput = join(root, authority ? "host-body.mjs" : "host.mjs");
	await writeFile(hostOutput, hostBundle.outputFiles[0].contents, {
		flag: "wx",
	});
	await remember(hostOutput);
	if (authority)
		await writeParticleAuthorityBootstrap({ root, authority, remember });
	const classicRequire = createRequire(
		new URL("../../packages/editor-classic/package.json", import.meta.url),
	);
	const mediabunnyEntry = join(
		dirname(classicRequire.resolve("mediabunny")),
		"../modules/src/index.js",
	);
	await buildBrowser({
		root: repo,
		configFile: false,
		envDir: root,
		envPrefix: "ROCUT_C4_EXPORT_PUBLIC_",
		cacheDir: join(root, "vite-cache"),
		base: "./",
		logLevel: "error",
		plugins: [
			wasm(),
			topLevelAwait(),
			{
				name: "c4-export-source-manifest",
				async transform(code, id) {
					if (id === "/__vite-plugin-wasm-helper") {
						generatedModules.set(id, {
							id,
							bytes: Buffer.byteLength(code),
							sha256: hash(code),
						});
						return null;
					}
					const path = id.split("?")[0];
					if (isAbsolute(path) && !path.includes("\0")) await remember(path);
					return null;
				},
			},
		],
		resolve: {
			alias: [
				{
					find: /^opencut-wasm$/,
					replacement: bundlerEntry,
				},
				{ find: /^mediabunny$/, replacement: mediabunnyEntry },
			],
		},
		build: {
			outDir: join(root, "editor"),
			emptyOutDir: false,
			rollupOptions: {
				input: join(repo, "script/fixtures/particle-editor-export.html"),
			},
		},
	});
	await writeJson(
		join(root, "browser-build-manifest.json"),
		await treeManifest(join(root, "editor")),
	);
	await writeJson(join(root, "source-manifest.json"), {
		sources: [...sources.values()],
		generatedModules: [...generatedModules.values()],
	});
	if (authority) {
		const assets = await treeManifest(join(root, "editor"));
		const wasmFiles = assets.files.filter(({ path }) => path.endsWith(".wasm"));
		assert.ok(
			wasmFiles.some(
				({ sha256 }) =>
					sha256 === authority.metadata.nativeAuthority.wasmSha256,
			),
			"Canonical WASM missing from output",
		);
		assert.ok(
			wasmFiles.every(
				({ sha256 }) =>
					sha256 === authority.metadata.nativeAuthority.wasmSha256,
			),
			"Unapproved emitted WASM",
		);
		await authority.assertUnchanged();
	}
}

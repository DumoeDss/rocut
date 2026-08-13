import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

interface ModuleLike {
	resource?: string;
	rawRequest?: string;
	userRequest?: string;
	request?: string;
	identifier?: () => string;
	modules?: Iterable<ModuleLike>;
}

interface ChunkLike {
	files: Iterable<string>;
	auxiliaryFiles?: Iterable<string>;
}

interface EntryPointLike {
	chunks: Iterable<ChunkLike>;
}

interface CompilationLike {
	modules: Iterable<ModuleLike>;
	entrypoints: Iterable<[string, EntryPointLike]>;
	assets: Record<string, unknown>;
	moduleGraph: {
		getOutgoingConnections(module: ModuleLike): Iterable<{
			module?: ModuleLike | null;
		}>;
	};
	chunkGraph: {
		getModuleChunksIterable(module: ModuleLike): Iterable<ChunkLike>;
	};
	fullHash?: string;
	hash?: string;
}

interface CompilerLike {
	outputPath: string;
	hooks: {
		afterEmit: {
			tapPromise(
				name: string,
				callback: (compilation: CompilationLike) => Promise<void>,
			): void;
		};
	};
}

interface ModuleRecord {
	id: string;
	rawIds: string[];
	chunks: string[];
}

interface PendingEnvelope {
	entry: {
		expected: string;
		observed: string;
		matchCount: number;
		emitted: boolean;
		webpackEntrypoint: string;
	};
	modules: ModuleRecord[];
	chunkFiles: string[];
	compilationId: string;
	wasmMirrors: Array<{
		asset: string;
		emittedPath: string;
		runtimePath: string;
		sha256: string;
	}>;
}

function slash(value: string): string {
	return value.replaceAll("\\", "/");
}

function digest(value: string | Uint8Array): string {
	return createHash("sha256").update(value).digest("hex");
}

function normalizeIdentity(args: { value: string; repoRoot: string }): string {
	const normalized = slash(args.value).replace(/^file:\/\//i, "");
	const root = slash(args.repoRoot).replace(/\/$/, "");
	return normalized.split(`${root}/`).join("");
}

function identities(args: { module: ModuleLike; repoRoot: string }): string[] {
	const candidates = [
		args.module.resource,
		args.module.rawRequest,
		args.module.userRequest,
		args.module.request,
		args.module.identifier?.(),
	].filter((value): value is string => Boolean(value));
	return [
		...new Set(
			candidates.map((value) =>
				normalizeIdentity({
					value,
					repoRoot: args.repoRoot,
				}),
			),
		),
	];
}

function resolvedResourceIdentity(args: {
	module: ModuleLike;
	repoRoot: string;
}): string | null {
	if (typeof args.module.resource !== "string" || !args.module.resource) {
		return null;
	}
	return normalizeIdentity({
		value: args.module.resource,
		repoRoot: args.repoRoot,
	}).replace(/[?#].*$/, "");
}

function canonicalModuleDigest(items: ModuleRecord[]): string {
	const canonical = items
		.map((item) => ({
			id: slash(item.id),
			rawIds: [...new Set(item.rawIds.map(slash))].sort(),
			chunks: [...new Set(item.chunks.map(slash))].sort(),
		}))
		.sort((left, right) =>
			`${left.id}\0${left.rawIds.join("\0")}`.localeCompare(
				`${right.id}\0${right.rawIds.join("\0")}`,
			),
		);
	return digest(JSON.stringify(canonical));
}

function nestedModules(module: ModuleLike): ModuleLike[] {
	return module.modules ? [...module.modules] : [];
}

function isMissingFile(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: unknown }).code === "ENOENT"
	);
}

export class HeadlessWebpackGraphPlugin {
	constructor(
		private readonly options: {
			repoRoot: string;
			outputRoot: string;
			entry: string;
			webpackEntrypoint: string;
			marker: string;
			acceptedHead: string;
			acceptedTree: string;
		},
	) {}

	apply(value: unknown): void {
		const compiler = value as CompilerLike;
		const pluginName = "OpenCutC7HeadlessWebpackGraph";
		compiler.hooks.afterEmit.tapPromise(pluginName, async (compilation) => {
			const wasmMirrors = await this.mirrorServerWasmAssets({
				compiler,
				compilation,
			});
			const collected = this.collect({
				compiler,
				compilation,
				wasmMirrors,
			});
			await this.writeEnvelope({ collected });
		});
	}

	private collect(args: {
		compiler: CompilerLike;
		compilation: CompilationLike;
		wasmMirrors: PendingEnvelope["wasmMirrors"];
	}): PendingEnvelope {
		const ownerByModule = new Map<ModuleLike, ModuleLike>();
		const allModules = new Set<ModuleLike>();
		const expand = (module: ModuleLike, owner: ModuleLike) => {
			allModules.add(module);
			const existingOwner = ownerByModule.get(module);
			if (
				!existingOwner ||
				this.chunkNames(args.compilation, existingOwner).length === 0
			) {
				ownerByModule.set(module, owner);
			}
			for (const nested of nestedModules(module)) expand(nested, owner);
		};
		for (const module of args.compilation.modules) expand(module, module);

		const entryMatches = [...allModules]
			.map((module) => ({
					module,
					observed: resolvedResourceIdentity({
					module,
					repoRoot: this.options.repoRoot,
				}),
			}))
			.filter(
				(
					match,
				): match is { module: ModuleLike; observed: string } =>
					match.observed === this.options.entry,
			);
		if (entryMatches.length !== 1) {
			throw new Error(
				`C7 Next headless entry resolved resource must match exactly once; found ${entryMatches.length}`,
			);
		}
		const rootMatch = entryMatches[0];
		const root = rootMatch.module;
		const webpackEntrypoints = [...args.compilation.entrypoints].filter(
			([name]) => name === this.options.webpackEntrypoint,
		);
		if (webpackEntrypoints.length !== 1) {
			throw new Error(
				`C7 Next webpack entrypoint must resolve exactly once; found ${webpackEntrypoints.length}`,
			);
		}
		const entrypointFiles = this.entrypointFiles(webpackEntrypoints[0][1]).map(
			(file) => this.outputRelative({ compiler: args.compiler, file }),
		);
		if (entrypointFiles.length === 0) {
			throw new Error(
				"C7 Next webpack entrypoint is not assigned to emitted output",
			);
		}
		const rootOwner = ownerByModule.get(root) ?? root;
		const rootActualChunks = this.chunkNames(
			args.compilation,
			rootOwner,
		).map((file) =>
			this.outputRelative({ compiler: args.compiler, file }),
		);
		if (rootActualChunks.length === 0) {
			throw new Error(
				"C7 Next exact root or concatenated owner has zero emitted chunks",
			);
		}
		const entrypointFileSet = new Set(entrypointFiles);
		const rootChunks = rootActualChunks.filter((file) =>
			entrypointFileSet.has(file),
		);
		if (rootChunks.length === 0) {
			throw new Error(
				"C7 Next exact root chunks do not belong to the named webpack entrypoint",
			);
		}

		const traversed = new Set<ModuleLike>();
		const reached = new Set<ModuleLike>();
		const pending = [root];
		while (pending.length > 0) {
			const current = pending.pop();
			if (!current || traversed.has(current)) continue;
			traversed.add(current);
			const owner = ownerByModule.get(current) ?? current;
			if (this.chunkNames(args.compilation, owner).length > 0) {
				reached.add(current);
			}
			for (const nested of nestedModules(current)) pending.push(nested);
			for (const connection of args.compilation.moduleGraph.getOutgoingConnections(
				current,
			)) {
				if (connection.module) pending.push(connection.module);
			}
		}

		const modules = [...reached]
			.map((module): ModuleRecord => {
				const rawIds = identities({ module, repoRoot: this.options.repoRoot });
				const resource =
					resolvedResourceIdentity({
						module,
						repoRoot: this.options.repoRoot,
					}) ?? rawIds[0];
				return {
					id: resource,
					rawIds,
					chunks:
						module === root
							? rootChunks
							: this.chunkNames(
									args.compilation,
									ownerByModule.get(module) ?? module,
								).map((file) =>
									this.outputRelative({ compiler: args.compiler, file }),
								),
				};
			})
			.filter((module) => Boolean(module.id))
			.sort((left, right) => left.id.localeCompare(right.id));
		const chunkFiles = [
			...new Set(modules.flatMap((module) => module.chunks)),
		].sort();
		return {
			entry: {
				expected: this.options.entry,
				observed: rootMatch.observed,
				matchCount: entryMatches.length,
				emitted: rootChunks.length > 0,
				webpackEntrypoint: this.options.webpackEntrypoint,
			},
			modules,
			chunkFiles,
			compilationId:
				args.compilation.fullHash ?? args.compilation.hash ?? "unknown",
			wasmMirrors: args.wasmMirrors,
		};
	}

	private async mirrorServerWasmAssets(args: {
		compiler: CompilerLike;
		compilation: CompilationLike;
	}): Promise<PendingEnvelope["wasmMirrors"]> {
		const outputRoot = resolve(this.options.repoRoot, this.options.outputRoot);
		const compilerOutput = resolve(args.compiler.outputPath);
		this.assertInsideOutput({ outputRoot, path: compilerOutput });
		const runtimeBase = dirname(compilerOutput);
		const mirrors = [];
		for (const asset of Object.keys(args.compilation.assets).filter((name) =>
			name.toLowerCase().endsWith(".wasm"),
		)) {
			const emittedPath = resolve(compilerOutput, asset);
			const runtimePath = resolve(runtimeBase, asset);
			this.assertInsideOutput({ outputRoot, path: emittedPath });
			this.assertInsideOutput({ outputRoot, path: runtimePath });
			if (emittedPath === runtimePath) continue;
			const bytes = await readFile(emittedPath);
			await mkdir(dirname(runtimePath), { recursive: true });
			try {
				const existing = await readFile(runtimePath);
				if (digest(existing) !== digest(bytes)) {
					throw new Error(
						`C7 proof WASM mirror conflicts with existing output: ${slash(relative(outputRoot, runtimePath))}`,
					);
				}
			} catch (error) {
				if (!isMissingFile(error)) throw error;
				await copyFile(emittedPath, runtimePath);
			}
			mirrors.push({
				asset: slash(asset),
				emittedPath: slash(relative(outputRoot, emittedPath)),
				runtimePath: slash(relative(outputRoot, runtimePath)),
				sha256: digest(bytes),
			});
		}
		return mirrors.sort((left, right) => left.asset.localeCompare(right.asset));
	}

	private assertInsideOutput(args: { outputRoot: string; path: string }): void {
		const relation = slash(relative(args.outputRoot, args.path));
		if (relation === ".." || relation.startsWith("../")) {
			throw new Error(`C7 proof output escaped its root: ${args.path}`);
		}
	}

	private entrypointFiles(entrypoint: EntryPointLike): string[] {
		const files = new Set<string>();
		for (const chunk of entrypoint.chunks) {
			for (const file of chunk.files) files.add(slash(file));
			for (const file of chunk.auxiliaryFiles ?? []) files.add(slash(file));
		}
		return [...files].sort();
	}

	private chunkNames(
		compilation: CompilationLike,
		module: ModuleLike,
	): string[] {
		const files = new Set<string>();
		for (const chunk of compilation.chunkGraph.getModuleChunksIterable(
			module,
		)) {
			for (const file of chunk.files) files.add(slash(file));
			for (const file of chunk.auxiliaryFiles ?? []) files.add(slash(file));
		}
		return [...files].sort();
	}

	private outputRelative(args: {
		compiler: CompilerLike;
		file: string;
	}): string {
		const absoluteOutput = resolve(
			this.options.repoRoot,
			this.options.outputRoot,
		);
		const absoluteFile = resolve(args.compiler.outputPath, args.file);
		const outputRelative = slash(relative(absoluteOutput, absoluteFile));
		if (outputRelative.startsWith("../")) {
			throw new Error(`C7 Next emitted file escaped output root: ${args.file}`);
		}
		return outputRelative;
	}

	private async writeEnvelope(args: {
		collected: PendingEnvelope;
	}): Promise<void> {
		const absoluteOutput = resolve(
			this.options.repoRoot,
			this.options.outputRoot,
		);
		const files = await Promise.all(
			args.collected.chunkFiles.map(async (path) => ({
				path,
				sha256: digest(await readFile(resolve(absoluteOutput, path))),
			})),
		);
		files.sort((left, right) => left.path.localeCompare(right.path));
		const fileSetSha256 = digest(JSON.stringify(files));
		const envelope = {
			schemaVersion: 1,
			producer: "next-webpack",
			host: "next",
			entry: args.collected.entry,
			acceptedBase: {
				head: this.options.acceptedHead,
				tree: this.options.acceptedTree,
			},
			build: {
				marker: this.options.marker,
				id: `next-webpack:${args.collected.compilationId}`,
				mode: "next-webpack-proof",
				proofWasmMirrors: args.collected.wasmMirrors,
			},
			attribution: {
				strategy: "webpack-exact-entrypoint-compilation-moduleGraph-chunkGraph",
				exactRoot: true,
				dependencyEdges: true,
				emittedIntersection: true,
			},
			output: {
				root: slash(this.options.outputRoot),
				files,
				fileSetSha256,
			},
			modules: {
				count: args.collected.modules.length,
				items: args.collected.modules,
				moduleSetSha256: canonicalModuleDigest(args.collected.modules),
			},
		};
		await writeFile(
			resolve(absoluteOutput, "c7-headless-graph.json"),
			`${JSON.stringify(envelope, null, 2)}\n`,
			"utf8",
		);
	}
}

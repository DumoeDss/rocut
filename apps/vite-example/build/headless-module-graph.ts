import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import type { Plugin } from "vite";

interface HeadlessModuleRecord {
	id: string;
	rawIds: string[];
	chunks: string[];
}

function slash(value: string): string {
	return value.replaceAll("\\", "/");
}

function splitSuffix(id: string): [string, string] {
	const index = id.search(/[?#]/);
	return index < 0 ? [id, ""] : [id.slice(0, index), id.slice(index)];
}

function normalizeId(args: { id: string; repoRoot: string }): string {
	if (args.id.startsWith("\0")) return slash(args.id);
	const [path, suffix] = splitSuffix(args.id);
	const repoRelative = slash(relative(args.repoRoot, path));
	return repoRelative.startsWith("../") || repoRelative === ""
		? slash(args.id)
		: repoRelative + suffix;
}

function digest(value: string | Uint8Array): string {
	return createHash("sha256").update(value).digest("hex");
}

function canonicalModuleDigest(items: HeadlessModuleRecord[]): string {
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

function htmlAttribute(attributes: string, name: string): string | null {
	const pattern = new RegExp(
		`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\\x60]+))`,
		"i",
	);
	const match = pattern.exec(attributes);
	return match ? (match[1] ?? match[2] ?? match[3] ?? "") : null;
}

function resolveFacadeScript(args: {
	src: string;
	facadePath: string;
	outputNames: Set<string>;
}): string | null {
	try {
		const origin = "https://c7-headless.invalid";
		const url = new URL(
			args.src,
			`${origin}/${slash(args.facadePath).replace(/^\/+/, "")}`,
		);
		if (url.origin !== origin) return null;
		const pathname = decodeURIComponent(url.pathname).replaceAll("\\", "/");
		const exact = pathname.replace(/^\/+/, "");
		if (args.outputNames.has(exact)) return exact;
		const suffixMatches = [...args.outputNames].filter((path) =>
			pathname.endsWith(`/${path}`),
		);
		return suffixMatches.length === 1 ? suffixMatches[0] : null;
	} catch {
		return null;
	}
}

function inspectHtmlFacade(args: {
	html: string;
	facadePath: string;
	outputNames: Set<string>;
}): Array<{ src: string | null; type: string; outputPath: string | null }> {
	const scripts = [];
	for (const tag of args.html.matchAll(/<script\b([^>]*)>/gi)) {
		const attributes = tag[1] ?? "";
		const src = htmlAttribute(attributes, "src");
		const type = htmlAttribute(attributes, "type") ?? "";
		scripts.push({
			src,
			type,
			outputPath:
				src === null
					? null
					: resolveFacadeScript({
							src,
							facadePath: args.facadePath,
							outputNames: args.outputNames,
						}),
		});
	}
	return scripts;
}

export function headlessModuleGraph(args: {
	repoRoot: string;
	outputRoot: string;
	entry: string;
	marker: string;
	acceptedHead: string;
	acceptedTree: string;
}): Plugin {
	let collected:
		| {
				entry: {
					expected: string;
					observed: string;
					matchCount: number;
					emitted: boolean;
				};
				modules: HeadlessModuleRecord[];
				moduleSetSha256: string;
				bundleFiles: string[];
				entryChunks: string[];
		  }
		| undefined;
	return {
		name: "opencut-c7-headless-module-graph",
		generateBundle(_options, bundle) {
			const rawIds = [...this.getModuleIds()];
			const entryMatches = rawIds.filter(
				(id) => normalizeId({ id, repoRoot: args.repoRoot }) === args.entry,
			);
			if (entryMatches.length !== 1) {
				throw new Error(
					`C7 Vite headless entry must resolve exactly once; found ${entryMatches.length}`,
				);
			}

			const membership = new Map<string, Set<string>>();
			for (const item of Object.values(bundle)) {
				if (item.type !== "chunk") continue;
				for (const id of Object.keys(item.modules)) {
					const chunks = membership.get(id) ?? new Set<string>();
					chunks.add(item.fileName);
					membership.set(id, chunks);
				}
			}
			const root = entryMatches[0];
			if (!membership.has(root)) {
				throw new Error("C7 Vite headless entry is not assigned to emitted output");
			}

			const traversed = new Set<string>();
			const reached = new Set<string>();
			const pending = [root];
			while (pending.length > 0) {
				const current = pending.pop();
				if (!current || traversed.has(current)) continue;
				traversed.add(current);
				if (membership.has(current)) reached.add(current);
				const info = this.getModuleInfo(current);
				for (const dependency of [
					...(info?.importedIds ?? []),
					...(info?.dynamicallyImportedIds ?? []),
				]) {
					pending.push(dependency);
				}
			}

			const modules = [...reached]
				.map((id): HeadlessModuleRecord => {
					const normalized = normalizeId({ id, repoRoot: args.repoRoot });
					return {
						id: normalized,
						rawIds: [normalized],
						chunks: [...(membership.get(id) ?? [])].map(slash).sort(),
					};
				})
				.sort((left, right) => left.id.localeCompare(right.id));
			const moduleSetSha256 = canonicalModuleDigest(modules);
			collected = {
				entry: {
					expected: args.entry,
					observed: normalizeId({ id: root, repoRoot: args.repoRoot }),
					matchCount: entryMatches.length,
					emitted: membership.has(root),
				},
				modules,
				moduleSetSha256,
				bundleFiles: Object.values(bundle)
					.map((item) => slash(item.fileName))
					.sort(),
				entryChunks: [...(membership.get(root) ?? [])].map(slash).sort(),
			};
		},
		async writeBundle() {
			if (!collected) {
				throw new Error("C7 Vite headless graph was not collected before write");
			}
			const pending = collected;
			const absoluteOutput = resolve(args.repoRoot, args.outputRoot);
			const facadePath = "headless.html";
			const outputPaths = [
				...new Set([...pending.bundleFiles, facadePath]),
			].sort();
			const outputFiles = await Promise.all(
				outputPaths.map(async (path) => ({
					path,
					sha256: digest(await readFile(resolve(absoluteOutput, path))),
				})),
			);
			outputFiles.sort((left, right) => left.path.localeCompare(right.path));
			const outputSetSha256 = digest(JSON.stringify(outputFiles));
			const facadeBytes = await readFile(resolve(absoluteOutput, facadePath));
			const outputNames = new Set(outputPaths);
			const scripts = inspectHtmlFacade({
				html: facadeBytes.toString("utf8"),
				facadePath,
				outputNames,
			});
			if (
				!scripts.some(
					(script) =>
						script.type.toLowerCase() === "module" &&
						pending.entryChunks.includes(script.outputPath ?? ""),
				)
			) {
				throw new Error(
					"C7 Vite executable HTML facade does not load the exact entry chunk",
				);
			}
			const envelope = {
				schemaVersion: 1,
				producer: "vite-rollup",
				host: "vite",
				entry: pending.entry,
				acceptedBase: { head: args.acceptedHead, tree: args.acceptedTree },
				build: {
					marker: args.marker,
					id: `vite:${args.marker}:${outputSetSha256.slice(0, 16)}`,
					mode: "vite-production",
				},
				attribution: {
					strategy:
						"vite-writeBundle-html-facade-rollup-entry-outgoing-closure",
					exactRoot: true,
					dependencyEdges: true,
					emittedIntersection: true,
				},
				output: {
					root: slash(args.outputRoot),
					files: outputFiles,
					fileSetSha256: outputSetSha256,
					facade: {
						path: facadePath,
						sha256: digest(facadeBytes),
						scripts,
						entryChunks: pending.entryChunks,
					},
				},
				modules: {
					count: pending.modules.length,
					items: pending.modules,
					moduleSetSha256: pending.moduleSetSha256,
				},
			};
			await writeFile(
				resolve(absoluteOutput, "c7-headless-graph.json"),
				`${JSON.stringify(envelope, null, 2)}\n`,
				"utf8",
			);
		},
	};
}

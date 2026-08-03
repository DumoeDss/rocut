#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(import.meta.url);
const REPO_ROOT = join(dirname(SCRIPT), "..");
const SOURCE_CHECK = join(dirname(SCRIPT), "check-runtime-asset-boundary.mjs");
const REQUIRED_LAYERS = [
	"entry",
	"transcription-worker",
	"editor-wasm",
	"ort-sidecar",
];
const FIRST_PARTY_PATH =
	/^\/(?:_next(?:\/|$)|assets(?:\/|$)|fonts(?:\/|$)|flags(?:\/|$)|effects(?:\/|$)|logos(?:\/|$)|workers(?:\/|$)|favicon(?:\.|\/|$)|api\/(?:sounds\/search|feedback)(?:[/?#]|$))/;
const PUBLIC_ORIGIN = "https://opencut.invalid";

function digest(bytes) {
	return createHash("sha256").update(bytes).digest("hex");
}

function normalizeBase(value, trailingSlash = true) {
	const clean = `/${String(value || "/").replace(/^\/+|\/+$/g, "")}`;
	if (clean === "/") return "/";
	return trailingSlash ? `${clean}/` : clean;
}

function publicPath(base, path) {
	const prefix = normalizeBase(base, false);
	return prefix === "/"
		? `/${path.replace(/^\/+/, "")}`
		: `${prefix}/${path.replace(/^\/+/, "")}`;
}

function option(name, fallback) {
	const index = process.argv.indexOf(name);
	return index >= 0 ? process.argv[index + 1] : fallback;
}

function listFiles(root) {
	if (!existsSync(root)) return [];
	const stat = statSync(root);
	if (!stat.isDirectory()) return [root];
	return readdirSync(root, { withFileTypes: true }).flatMap((entry) =>
		entry.isDirectory()
			? listFiles(join(root, entry.name))
			: [join(root, entry.name)],
	);
}

function relativePath(root, path) {
	return relative(root, path).split(sep).join("/");
}

function inventoryEntry({ output, path, layer, url }) {
	const bytes = readFileSync(path);
	return {
		output,
		file: relativePath(output, path),
		layer,
		url,
		bytes: bytes.byteLength,
		sha256: digest(bytes),
	};
}

function viteInventory(output, base) {
	const manifestPath = join(output, "asset-manifest.json");
	if (!existsSync(manifestPath)) {
		return {
			entries: [],
			filesToScan: [],
			violations: [
				violation("missing-vite-manifest", manifestPath, "graph", "<missing>"),
			],
		};
	}
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	const entries = [];
	const violations = [];
	for (const layer of REQUIRED_LAYERS) {
		for (const item of manifest.emitted?.files?.filter(
			(candidate) => candidate.classification === layer,
		) ?? []) {
			const path = join(output, ...item.path.split("/"));
			if (!existsSync(path)) {
				violations.push(
					violation(
						"missing-emitted-file",
						item.path,
						layer,
						`${base}${item.path}`,
					),
				);
				continue;
			}
			const entry = inventoryEntry({
				output,
				path,
				layer,
				url: `${base}${item.path}`,
			});
			entries.push(entry);
			if (entry.bytes !== item.bytes || entry.sha256 !== item.sha256) {
				violations.push(
					violation("emitted-inventory-mismatch", item.path, layer, entry.url),
				);
			}
		}
	}
	const filesToScan = listFiles(output).filter((path) =>
		/\.(?:html|css|js|mjs)$/i.test(path),
	);
	return { entries, filesToScan, violations, manifestPath };
}

const GRAPH_TEXT_FILE = /\.(?:html|css|js|mjs|ts)$/i;
const NEXT_STATIC_REFERENCE = /^static\/(?:chunks|css|media)\/.+/i;
const NEXT_STATIC_DIRECTORY = /^static\/(?:chunks|css|media)(?:\/|$)/i;
const EDITOR_WASM_SOURCE = join(
	REPO_ROOT,
	"rust",
	"wasm",
	"pkg",
	"opencut_wasm_bg.wasm",
);
let editorWasmDigest;

function cleanReference(reference) {
	return String(reference)
		.split(/[?#]/, 1)[0]
		.replaceAll("\\/", "/")
		.replaceAll("\\", "/");
}

function filesystemReference(reference) {
	const clean = cleanReference(reference);
	try {
		return decodeURIComponent(clean);
	} catch {
		return clean;
	}
}

function expectedEditorWasmDigest() {
	if (editorWasmDigest !== undefined) return editorWasmDigest;
	editorWasmDigest = existsSync(EDITOR_WASM_SOURCE)
		? digest(readFileSync(EDITOR_WASM_SOURCE))
		: null;
	return editorWasmDigest;
}

function browserReferences(text, sourcePath = "") {
	const references = [];
	const add = (reference, kind) => {
		const value = String(reference).trim();
		if (
			!value ||
			value.startsWith("#") ||
			value.startsWith("//") ||
			/^(?:data|blob|https?|file):/i.test(value)
		) {
			return;
		}
		if (
			!value.startsWith("/") &&
			!value.startsWith("./") &&
			!value.startsWith("../") &&
			!NEXT_STATIC_REFERENCE.test(value)
		) {
			return;
		}
		references.push({ reference: value, kind });
	};
	for (const match of text.matchAll(/["'`]([^"'`\s\\)>,;]+)["'`]/g)) {
		if (match[1].startsWith("/") || NEXT_STATIC_REFERENCE.test(match[1])) {
			add(
				match[1],
				NEXT_STATIC_REFERENCE.test(match[1])
					? "next-static-root"
					: "quoted-url",
			);
		}
	}
	if (/\.(?:js|mjs|ts)$/i.test(sourcePath)) {
		for (const match of text.matchAll(
			/(?:\bimport|\bfetch|\bimportScripts|new\s+(?:Worker|SharedWorker|URL))\s*\(\s*["'`]([^"'`]+)["'`]/g,
		)) {
			add(match[1], "runtime-call");
		}
		for (const match of text.matchAll(
			/\b(?:import|export)\s+(?:[^"'`;]+?\s+from\s+)?["'`]([^"'`]+)["'`]/g,
		)) {
			add(match[1], "module-import");
		}
	}
	for (const match of text.matchAll(
		/url\(\s*(?:["']([^"']+)["']|([^)'"\s]+))\s*\)/gi,
	)) {
		add(match[1] ?? match[2], "css-url");
	}
	for (const match of text.matchAll(
		/(?:src|href)\s*=\s*(?:["']([^"']+)["']|([^\s>]+))/gi,
	)) {
		add(match[1] ?? match[2], "html-attribute");
	}
	return [
		...new Map(references.map((item) => [item.reference, item])).values(),
	];
}

function parseNextClientManifest(text) {
	const match = text.match(
		/globalThis\.__RSC_MANIFEST(?:\[(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\])?\s*=\s*(\{[\s\S]*\})\s*;?\s*$/,
	);
	if (!match) return undefined;
	try {
		return JSON.parse(match[1]);
	} catch {
		return undefined;
	}
}

function collectManifestStrings(value, output = []) {
	if (typeof value === "string") output.push(value);
	else if (Array.isArray(value)) {
		for (const item of value) collectManifestStrings(item, output);
	} else if (value && typeof value === "object") {
		for (const item of Object.values(value))
			collectManifestStrings(item, output);
	}
	return output;
}

function nextClientManifestReferences(manifest) {
	const references = [];
	for (const clientModule of Object.values(manifest.clientModules ?? {})) {
		collectManifestStrings(clientModule?.chunks, references);
	}
	collectManifestStrings(manifest.entryCSSFiles, references);
	collectManifestStrings(manifest.entryJSFiles, references);
	return [...new Set(references)];
}

function isInside(root, path) {
	const resolvedRoot = resolve(root);
	const resolvedPath = resolve(path);
	return (
		resolvedPath === resolvedRoot ||
		resolvedPath.startsWith(`${resolvedRoot}${sep}`)
	);
}

function artifactLayer(path, text = "") {
	const normalized = String(path).replaceAll("\\", "/");
	const basename = normalized.split("/").at(-1) ?? "";
	if (/^ort-wasm(?:[-._][a-z0-9]+)*\.wasm$/i.test(basename)) {
		return "ort-sidecar";
	}
	if (/\.wasm$/i.test(basename)) {
		if (
			/^opencut(?:[-_.](?:editor|wasm|wasm-bg|wasm_bg)(?:[-._][a-z0-9]+)*)?\.wasm$/i.test(
				basename,
			)
		) {
			return "editor-wasm";
		}
		const expected = expectedEditorWasmDigest();
		if (
			expected &&
			existsSync(path) &&
			digest(readFileSync(path)) === expected
		) {
			return "editor-wasm";
		}
		return "resource";
	}
	if (
		/\.(?:js|mjs|ts)$/i.test(normalized) &&
		(/transcription[^/]*worker|worker[^/]*transcription/i.test(normalized) ||
			(/postMessage/.test(text) &&
				/ort-wasm-simd-threaded|transcription|@huggingface\/transformers/i.test(
					text,
				)))
	) {
		return "transcription-worker";
	}
	return "browser-chunk";
}

function referenceLayer(reference, targetPath, text = "") {
	const clean = cleanReference(reference);
	if (/ort-wasm.*\.wasm$/i.test(clean)) return "ort-sidecar";
	if (/opencut.*\.wasm$/i.test(clean)) return "editor-wasm";
	if (/worker[^/]*\.(?:js|mjs|ts)$/i.test(clean)) return "transcription-worker";
	if (!targetPath) return "browser-chunk";
	const targetText =
		GRAPH_TEXT_FILE.test(targetPath) && existsSync(targetPath)
			? readFileSync(targetPath, "utf8")
			: text;
	return artifactLayer(targetPath, targetText);
}

function publicUrlInsideBase(pathname, base) {
	const normalizedBase = normalizeBase(base, true);
	const baseWithoutSlash = normalizeBase(base, false);
	return (
		normalizedBase === "/" ||
		pathname === baseWithoutSlash ||
		pathname.startsWith(normalizedBase)
	);
}

function staticPathFromPublicUrl(output, pathname, base) {
	const nextPrefix = publicPath(base, "_next/");
	if (!pathname.startsWith(nextPrefix)) return undefined;
	const relativeFile = pathname.slice(nextPrefix.length);
	if (!NEXT_STATIC_DIRECTORY.test(relativeFile)) return undefined;
	return resolve(output, ...relativeFile.split("/"));
}

function browserUrlForStaticPath(output, path, base) {
	const rel = relativePath(output, path);
	return publicPath(base, `_next/${rel}`);
}

function resolveNextBrowserReference({
	output,
	base,
	from,
	fromUrl,
	reference,
	kind,
	expectedLayer,
	violations,
}) {
	const staticRoot = resolve(output, "static");
	const clean = cleanReference(reference);
	const filesystemPath = filesystemReference(reference);
	const normalizedReference = String(reference).replaceAll("\\", "/");
	const isStaticRoot = NEXT_STATIC_REFERENCE.test(clean);
	if (
		clean.startsWith("/") &&
		!clean.includes("/_next/") &&
		!FIRST_PARTY_PATH.test(clean) &&
		!publicUrlInsideBase(clean, base)
	) {
		return undefined;
	}
	let resolvedUrl;
	let targetPath;
	try {
		if (isStaticRoot) {
			resolvedUrl = new URL(
				publicPath(base, `_next/${clean}`),
				"https://rocut.invalid/",
			);
			targetPath = resolve(output, ...filesystemPath.split("/"));
		} else {
			resolvedUrl = new URL(
				normalizedReference,
				new URL(fromUrl, "https://rocut.invalid/"),
			);
			if (clean.startsWith("./") || clean.startsWith("../")) {
				targetPath = resolve(dirname(from), ...filesystemPath.split("/"));
			} else {
				targetPath = staticPathFromPublicUrl(
					output,
					resolvedUrl.pathname,
					base,
				);
			}
		}
	} catch {
		violations.push(
			violation(
				"invalid-browser-reference",
				relativePath(output, from),
				"graph",
				reference,
			),
		);
		return undefined;
	}

	const sourceText =
		GRAPH_TEXT_FILE.test(from) && existsSync(from)
			? readFileSync(from, "utf8")
			: "";
	const targetLayer =
		expectedLayer ?? referenceLayer(reference, targetPath, sourceText);
	if (!publicUrlInsideBase(resolvedUrl.pathname, base)) {
		const rule =
			clean.startsWith("./") || clean.startsWith("../")
				? "relative-public-base-escape"
				: urlRule(targetLayer, reference);
		violations.push(
			violation(rule, relativePath(output, from), targetLayer, reference),
		);
		return undefined;
	}

	if (clean.startsWith("./") || clean.startsWith("../")) {
		if (!isInside(output, targetPath)) {
			violations.push(
				violation(
					"relative-next-output-escape",
					relativePath(output, from),
					targetLayer,
					reference,
				),
			);
			return undefined;
		}
		if (!isInside(staticRoot, targetPath)) {
			violations.push(
				violation(
					"relative-next-static-escape",
					relativePath(output, from),
					targetLayer,
					reference,
				),
			);
			return undefined;
		}
	}

	if (!targetPath) return undefined;
	if (!isInside(staticRoot, targetPath)) {
		violations.push(
			violation(
				"next-static-containment",
				relativePath(output, from),
				targetLayer,
				reference,
			),
		);
		return undefined;
	}
	const targetRelative = relativePath(output, targetPath);
	if (!NEXT_STATIC_DIRECTORY.test(targetRelative)) {
		violations.push(
			violation(
				"next-static-category-escape",
				relativePath(output, from),
				targetLayer,
				reference,
			),
		);
		return undefined;
	}
	return {
		path: targetPath,
		url: `${resolvedUrl.pathname}${resolvedUrl.search}${resolvedUrl.hash}`,
		kind,
		reference,
	};
}

function nextClientGraph(output, seeds, base, entryRoots, violations) {
	const staticRoot = resolve(output, "static");
	const pending = [
		...new Map(seeds.map((seed) => [resolve(seed.path), seed])).values(),
	];
	const visited = new Map();
	const edges = [];
	while (pending.length > 0) {
		const seed = pending.shift();
		const path = resolve(seed.path);
		if (visited.has(path)) continue;
		if (!existsSync(path)) {
			violations.push(
				violation(
					"missing-reachable-next-file",
					relativePath(output, path),
					referenceLayer(seed.reference ?? seed.url, path),
					seed.reference ?? seed.url,
				),
			);
			continue;
		}
		const text = GRAPH_TEXT_FILE.test(path) ? readFileSync(path, "utf8") : "";
		const detectedLayer = artifactLayer(path, text);
		const layer = entryRoots.has(path) ? "entry" : detectedLayer;
		const node = { path, url: seed.url, layer };
		visited.set(path, node);
		if (!GRAPH_TEXT_FILE.test(path)) continue;
		for (const item of browserReferences(text, path)) {
			const dependency = resolveNextBrowserReference({
				output,
				base,
				from: path,
				fromUrl: seed.url,
				reference: item.reference,
				kind: item.kind,
				expectedLayer:
					!isInside(staticRoot, path) &&
					/\.(?:js|mjs|ts)(?:[?#]|$)/i.test(item.reference)
						? "entry"
						: undefined,
				violations,
			});
			if (!dependency) continue;
			edges.push({
				from: path,
				to: dependency.path,
				kind: dependency.kind,
				reference: dependency.reference,
				resolvedUrl: dependency.url,
			});
			if (!visited.has(dependency.path)) pending.push(dependency);
		}
	}
	return {
		files: [...visited.keys()],
		nodes: visited,
		edges,
	};
}

function reachablePath(edges, starts, targets) {
	const targetSet = new Set(targets);
	const adjacent = new Map();
	for (const edge of edges) {
		const values = adjacent.get(edge.from) ?? [];
		values.push(edge.to);
		adjacent.set(edge.from, values);
	}
	const pending = starts.map((path) => [path]);
	const seen = new Set(starts);
	while (pending.length > 0) {
		const path = pending.shift();
		const current = path.at(-1);
		if (targetSet.has(current)) return path;
		for (const next of adjacent.get(current) ?? []) {
			if (seen.has(next)) continue;
			seen.add(next);
			pending.push([...path, next]);
		}
	}
	return undefined;
}

function topologyEvidence(output, edges, layersByFile) {
	const filesForLayer = (layer) =>
		[...layersByFile.entries()]
			.filter(([, value]) => value === layer)
			.map(([path]) => path);
	return [
		["entry-to-transcription-worker", "entry", "transcription-worker"],
		["entry-to-editor-wasm", "entry", "editor-wasm"],
		[
			"transcription-worker-to-ort-sidecar",
			"transcription-worker",
			"ort-sidecar",
		],
	].map(([requirement, fromLayer, toLayer]) => {
		const path = reachablePath(
			edges,
			filesForLayer(fromLayer),
			filesForLayer(toLayer),
		);
		return {
			requirement,
			fromLayer,
			toLayer,
			satisfied: Boolean(path),
			path: path?.map((item) => relativePath(output, item)) ?? [],
		};
	});
}

function nextInventory(output, base) {
	const staticRoot = join(output, "static");
	const serverChunksRoot = join(output, "server", "chunks");
	const editorRouteRoot = join(output, "server", "app", "editor");
	const manifestPath = join(
		output,
		"server",
		"app",
		"editor",
		"[project_id]",
		"page_client-reference-manifest.js",
	);
	const violations = [];
	if (!existsSync(manifestPath)) {
		return {
			entries: [],
			filesToScan: [],
			violations: [
				violation(
					"missing-next-editor-manifest",
					manifestPath,
					"graph",
					"<missing>",
				),
			],
		};
	}
	const manifest = readFileSync(manifestPath, "utf8");
	const parsedManifest = parseNextClientManifest(manifest);
	if (!parsedManifest) {
		return {
			entries: [],
			filesToScan: [],
			violations: [
				violation(
					"invalid-next-editor-manifest",
					manifestPath,
					"graph",
					"<invalid>",
				),
			],
			manifestPath,
		};
	}
	const manifestBrowserReferences =
		nextClientManifestReferences(parsedManifest);
	const editorRouteFiles = listFiles(editorRouteRoot).filter(
		(path) =>
			/\.(?:html|css)$/i.test(path) ||
			/_client-reference-manifest\.js$/i.test(path),
	);
	const browserRouteRoots = editorRouteFiles.filter((path) =>
		/\.(?:html|css)$/i.test(path),
	);
	const manifestSeeds = [];
	for (const reference of manifestBrowserReferences) {
		const dependency = resolveNextBrowserReference({
			output,
			base,
			from: manifestPath,
			fromUrl: `${normalizeBase(base, true)}editor/fixture`,
			reference,
			kind: "next-client-manifest",
			expectedLayer: /\.(?:js|mjs|ts)(?:[?#]|$)/i.test(reference)
				? "entry"
				: undefined,
			violations,
		});
		if (dependency) manifestSeeds.push(dependency);
	}
	const routeSeeds = browserRouteRoots.map((path) => ({
		path,
		url: `${normalizeBase(base, true)}editor/fixture/${relativePath(editorRouteRoot, path)}`,
		kind: "editor-route-root",
		reference: relativePath(output, path),
	}));
	const entryRoots = new Set(
		manifestSeeds
			.filter((seed) => /\.(?:js|mjs|ts)$/i.test(seed.path))
			.map((seed) => resolve(seed.path)),
	);
	for (const route of routeSeeds) {
		if (!GRAPH_TEXT_FILE.test(route.path)) continue;
		for (const item of browserReferences(
			readFileSync(route.path, "utf8"),
			route.path,
		)) {
			const discoveryViolations = [];
			const dependency = resolveNextBrowserReference({
				output,
				base,
				from: route.path,
				fromUrl: route.url,
				reference: item.reference,
				kind: item.kind,
				expectedLayer: /\.(?:js|mjs|ts)(?:[?#]|$)/i.test(item.reference)
					? "entry"
					: undefined,
				violations: discoveryViolations,
			});
			if (dependency && /\.(?:js|mjs|ts)$/i.test(dependency.path)) {
				entryRoots.add(resolve(dependency.path));
			}
		}
	}
	const clientGraph = nextClientGraph(
		output,
		[...manifestSeeds, ...routeSeeds],
		base,
		entryRoots,
		violations,
	);
	for (const path of clientGraph.files.filter((path) =>
		isInside(serverChunksRoot, path),
	)) {
		violations.push(
			violation(
				"server-bundle-in-browser-graph",
				relativePath(output, path),
				"graph",
				"<server-only>",
			),
		);
	}
	const entries = [];
	const layersByFile = new Map();
	for (const path of clientGraph.files) {
		if (!isInside(staticRoot, path)) continue;
		const layer = clientGraph.nodes.get(resolve(path))?.layer ?? "resource";
		layersByFile.set(resolve(path), layer);
		if (!REQUIRED_LAYERS.includes(layer)) continue;
		entries.push(
			inventoryEntry({
				output,
				path,
				layer,
				url: browserUrlForStaticPath(output, path, base),
			}),
		);
	}
	const filesToScan = [
		...new Set([manifestPath, ...editorRouteFiles, ...clientGraph.files]),
	].filter(existsSync);
	const hasStaticClientGraph = clientGraph.files.some((path) =>
		isInside(staticRoot, path),
	);
	if (!hasStaticClientGraph) {
		violations.push(
			violation(
				"empty-next-browser-scan",
				`${output}:<browser-output>`,
				"graph",
				"<empty>",
			),
		);
	}
	const edges = clientGraph.edges.map((edge) => ({
		from: relativePath(output, edge.from),
		to: relativePath(output, edge.to),
		fromLayer:
			layersByFile.get(resolve(edge.from)) ??
			clientGraph.nodes.get(resolve(edge.from))?.layer ??
			"resource",
		toLayer:
			layersByFile.get(resolve(edge.to)) ??
			clientGraph.nodes.get(resolve(edge.to))?.layer ??
			"resource",
		kind: edge.kind,
		ref: edge.reference,
		reference: edge.reference,
		resolvedUrl: edge.resolvedUrl,
	}));
	const topology = topologyEvidence(output, clientGraph.edges, layersByFile);
	return {
		entries,
		filesToScan,
		layersByFile,
		visitedNodes: [...clientGraph.nodes.values()].map((node) => ({
			file: relativePath(output, node.path),
			url: node.url,
			layer: node.layer,
		})),
		edges,
		topology,
		violations,
		manifestPath,
	};
}

function violation(rule, file, layer, url) {
	return { rule, file: String(file), layer, url };
}

function urlRule(layer, url) {
	if (layer === "ort-sidecar" || /ort-wasm/i.test(url))
		return "root-ort-sidecar-url";
	if (
		layer === "editor-wasm" ||
		/opencut.*\.wasm|\.wasm(?:[?#]|$)/i.test(url)
	) {
		return "root-editor-wasm-url";
	}
	if (
		layer === "transcription-worker" ||
		/worker[^/]*\.(?:js|mjs|ts)(?:[?#]|$)/i.test(url)
	) {
		return "root-worker-url";
	}
	if (/^\/_next(?:\/|$)/.test(url)) return "root-next-entry-url";
	return "root-emitted-entry-url";
}

function quotedPaths(text) {
	const paths = [];
	for (const match of text.matchAll(/["'`](\/[^"'`\s\\)>,;]*)/g))
		paths.push(match[1]);
	for (const match of text.matchAll(/url\(\s*(\/[^)\s"']+)/gi))
		paths.push(match[1]);
	return [...new Set(paths)];
}

function resolvePublicUrl(url, base) {
	try {
		const resolved = new URL(
			url,
			`${PUBLIC_ORIGIN}${normalizeBase(base, true)}`,
		);
		if (resolved.origin !== PUBLIC_ORIGIN) return null;
		return resolved.pathname;
	} catch {
		return null;
	}
}

function scanEscapingUrls({ output, files, base, layersByFile = new Map() }) {
	const violations = [];
	const normalizedBase = normalizeBase(base, true);
	for (const path of files) {
		if (!/\.(?:html|css|js|mjs|ts)$/i.test(path)) continue;
		const text = readFileSync(path, "utf8");
		const rel = relativePath(output, path);
		const sourceLayer =
			layersByFile.get(resolve(path)) ??
			(/worker/i.test(rel) ? "transcription-worker" : "entry");
		const urls = /_client-reference-manifest\.js$/i.test(rel)
			? nextClientManifestReferences(parseNextClientManifest(text) ?? {})
			: quotedPaths(text);
		for (const url of urls) {
			const mountedCandidate =
				normalizedBase !== "/" && url.startsWith(normalizedBase);
			const originRelativeCandidate = /^\/\/[^/]/.test(url);
			if (
				!FIRST_PARTY_PATH.test(url) &&
				!mountedCandidate &&
				!originRelativeCandidate
			)
				continue;
			const canonicalPath = resolvePublicUrl(url, normalizedBase);
			// A root public base contains every canonical root-relative first-party URL.
			// For a mounted base, containment follows WHATWG URL resolution so literal
			// and encoded dot segments cannot hide an escape behind a raw prefix.
			if (
				canonicalPath !== null &&
				(normalizedBase === "/" || canonicalPath.startsWith(normalizedBase))
			)
				continue;
			const detectedLayer = referenceLayer(url, undefined, text);
			const layer =
				detectedLayer === "browser-chunk" ? sourceLayer : detectedLayer;
			violations.push(violation(urlRule(layer, url), rel, layer, url));
		}
	}
	return violations;
}

function missingLayerViolations(entries, host) {
	if (entries.length === 0) {
		return [
			violation("empty-emitted-graph", `${host}:<graph>`, "graph", "<empty>"),
		];
	}
	const present = new Set(entries.map((entry) => entry.layer));
	return REQUIRED_LAYERS.filter((layer) => !present.has(layer)).map((layer) =>
		violation("missing-emitted-layer", `${host}:<graph>`, layer, "<missing>"),
	);
}

function acceptanceViolations(report) {
	const layersByFile =
		report.layersByFile ??
		new Map(
			report.entries.map((entry) => [
				resolve(report.output, ...entry.file.split("/")),
				entry.layer,
			]),
		);
	return [
		...report.violations,
		...missingLayerViolations(report.entries, report.host),
		...(report.host === "next"
			? (report.topology ?? [])
					.filter((item) => !item.satisfied)
					.map((item) =>
						violation(
							"missing-runtime-topology",
							`${report.host}:<graph>`,
							item.toLayer,
							item.requirement,
						),
					)
			: scanEscapingUrls({
					output: report.output,
					files: report.filesToScan,
					base: report.base,
					layersByFile,
				})),
	];
}

function printViolation(item) {
	console.error(
		`[${item.rule}] file=${item.file} layer=${item.layer} url=${item.url}`,
	);
}

function writeFixtureFile(root, relativeFile, content = "") {
	const path = join(root, ...relativeFile.split("/"));
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content);
	return path;
}

function runViteParserFixture({
	dotSegmentEscape,
	rootEscape,
	base = "/c4-vite/",
	empty = false,
	truncated = false,
} = {}) {
	const output = mkdtempSync(join(tmpdir(), "rocut-vite-emitted-"));
	const assetUrl = (path, layer) => {
		if (rootEscape === layer) return `/assets/${path}`;
		if (layer === "entry" && dotSegmentEscape) {
			const segment = dotSegmentEscape === "encoded" ? "%2e%2e" : "..";
			return `${base}${segment}/assets/${path}`;
		}
		return `${base}assets/${path}`;
	};
	try {
		const files = [
			{
				path: "assets/entry.js",
				classification: "entry",
				content: [
					`export const entry = "${assetUrl("entry.js", "entry")}";`,
					`export const worker = "${assetUrl("transcription-worker.js", "transcription-worker")}";`,
					`export const editorWasm = "${assetUrl("opencut-editor.wasm", "editor-wasm")}";`,
				].join("\n"),
			},
			{
				path: "assets/transcription-worker.js",
				classification: "transcription-worker",
				content: `const ort = "${assetUrl("ort-wasm-simd-threaded.jsep.wasm", "ort-sidecar")}"; self.postMessage(ort);`,
			},
			{
				path: "assets/opencut-editor.wasm",
				classification: "editor-wasm",
				content: readFileSync(EDITOR_WASM_SOURCE),
			},
			{
				path: "assets/ort-wasm-simd-threaded.jsep.wasm",
				classification: "ort-sidecar",
				content: "fixture-ort",
			},
		];
		const selected = empty
			? []
			: truncated
				? files.filter((item) =>
						["entry", "editor-wasm"].includes(item.classification),
					)
				: files;
		for (const item of selected)
			writeFixtureFile(output, item.path, item.content);
		const emitted = selected.map((item) => {
			const bytes = readFileSync(join(output, ...item.path.split("/")));
			return {
				path: item.path,
				classification: item.classification,
				bytes: bytes.byteLength,
				sha256: digest(bytes),
			};
		});
		writeFixtureFile(
			output,
			"asset-manifest.json",
			`${JSON.stringify({ emitted: { files: emitted } }, null, 2)}\n`,
		);
		const report = {
			host: "vite",
			base,
			output,
			...viteInventory(output, base),
		};
		const violations = acceptanceViolations(report);
		for (const item of violations) printViolation(item);
		if (violations.length > 0) process.exitCode = 1;
		else console.log("fixture Vite emitted inventory clean");
	} finally {
		rmSync(output, { recursive: true, force: true });
	}
}

function runNextParserFixture({
	contained = true,
	base = "/c4-next/",
	disconnected = false,
	deletedReachable = false,
	deletedRelativeLazy = false,
	deletedRelativeMedia = false,
	directEntryOrt = false,
	relativeCssEscape = false,
	relativeCssOutputEscape = false,
	relativeCssStaticEscape = false,
	relativeLazyStaticEscape = false,
	relativeLazyRootEscape = false,
	sharedEntryWorkerWasm = false,
	unrelatedEditorWasm = false,
	rootEscape,
} = {}) {
	const output = mkdtempSync(join(tmpdir(), "rocut-next-emitted-"));
	const mountedPath = (rootPath) => publicPath(base, rootPath);
	const nextUrl = (rootPath, layer) => {
		if (!contained || rootEscape === layer) return rootPath;
		return mountedPath(rootPath);
	};
	try {
		const entryUrl = nextUrl("/_next/static/chunks/good-entry.js", "entry");
		const workerUrl = nextUrl(
			"/_next/static/chunks/transcription-worker.js",
			"transcription-worker",
		);
		const editorWasmUrl = nextUrl(
			`/_next/static/media/${unrelatedEditorWasm ? "unrelated.wasm" : "opencut-editor.wasm"}`,
			"editor-wasm",
		);
		const ortUrl = nextUrl(
			"/_next/static/media/ort-wasm-simd-threaded.jsep.wasm",
			"ort-sidecar",
		);
		writeFixtureFile(
			output,
			"server/app/editor/[project_id]/page_client-reference-manifest.js",
			`globalThis.__RSC_MANIFEST = ${JSON.stringify({
				clientModules: { editor: { chunks: [entryUrl] } },
				entryCSSFiles: {
					editor: [mountedPath("/_next/static/css/editor.css")],
				},
				ssrModuleMapping: {
					editor: { chunks: ["server/chunks/unrelated.js"] },
				},
			})};`,
		);
		writeFixtureFile(
			output,
			"server/app/editor/[project_id]/page.html",
			`<script src="${entryUrl}"></script><link rel="stylesheet" href="${mountedPath("/_next/static/css/editor.css")}">${!contained ? '<link rel="preload" href="/_next/static/chunks/root-html.js">' : ""}`,
		);
		writeFixtureFile(
			output,
			"server/app/editor/[project_id]/editor.css",
			`.root { background: url("${relativeCssEscape ? "../../../../../../flags/relative-root-css.png" : contained ? mountedPath("/flags/editor.svg") : "/flags/root-css.png"}"); }`,
		);
		writeFixtureFile(
			output,
			"static/chunks/good-entry.js",
			[
				`import("${relativeLazyStaticEscape ? "../../server/chunks/unrelated.js" : "./lazy-relative.mjs?runtime=1#chunk"}");`,
				`export const editorWasm = "${editorWasmUrl}";`,
				...(sharedEntryWorkerWasm
					? [
							'const sharedWorkerMarker = "transcription"; postMessage(sharedWorkerMarker);',
						]
					: []),
				...(disconnected
					? []
					: [
							`export const worker = new Worker("${workerUrl}", { type: "module" });`,
						]),
				...(directEntryOrt ? [`export const directOrt = "${ortUrl}";`] : []),
			].join("\n"),
		);
		if (!deletedRelativeLazy) {
			writeFixtureFile(
				output,
				"static/chunks/lazy-relative.mjs",
				`export const asset = "${relativeLazyRootEscape || !contained ? "/flags/root-lazy.svg" : mountedPath("/flags/lazy.svg")}";`,
			);
		}
		if (!deletedReachable) {
			writeFixtureFile(
				output,
				"static/chunks/transcription-worker.js",
				directEntryOrt
					? `self.postMessage({ type: "ready" });`
					: `const wasm = "${ortUrl}"; self.postMessage({ type: "ready", wasm });`,
			);
		}
		if (!contained)
			writeFixtureFile(output, "static/chunks/root-html.js", `export {};`);
		writeFixtureFile(
			output,
			"static/css/editor.css",
			`.editor { src: url("${relativeCssOutputEscape ? "../../../flags/outside-next.png" : relativeCssStaticEscape ? "../../server/chunks/server-only.js" : "../media/font.woff2?font=1#face"}"); color: green; }`,
		);
		if (!deletedRelativeMedia) {
			writeFixtureFile(output, "static/media/font.woff2", "fixture-font");
		}
		writeFixtureFile(
			output,
			`static/media/${unrelatedEditorWasm ? "unrelated.wasm" : "opencut-editor.wasm"}`,
			unrelatedEditorWasm ? "unrelated-wasm" : readFileSync(EDITOR_WASM_SOURCE),
		);
		writeFixtureFile(
			output,
			"static/media/ort-wasm-simd-threaded.jsep.wasm",
			"ort-wasm",
		);
		writeFixtureFile(
			output,
			"server/chunks/unrelated.js",
			`const serverOnly = "/_next/static/chunks/server-only.js"; const wasm = "/assets/ort-wasm-simd-threaded.server.wasm"; postMessage({ serverOnly, wasm });`,
		);

		const report = {
			host: "next",
			base,
			output,
			...nextInventory(output, base),
		};
		const violations = acceptanceViolations(report);
		for (const item of violations) printViolation(item);
		if (violations.length > 0) process.exitCode = 1;
		else {
			const edgeEvidenceComplete = (report.edges ?? []).every(
				(edge) => edge.from && edge.to && edge.kind && edge.ref,
			);
			const topologyEvidenceComplete = (report.topology ?? []).every(
				(item) => item.satisfied && item.path.length >= 2,
			);
			if (!edgeEvidenceComplete || !topologyEvidenceComplete) {
				throw new Error(
					"clean fixture omitted edge/kind/ref or topology path evidence",
				);
			}
			console.log(
				`fixture graph clean: ${report.edges?.length ?? 0} visited edges; server/chunks/unrelated.js excluded`,
			);
			console.log(
				`topology evidence: ${report.topology.map((item) => `${item.requirement}=${item.path.join(" -> ")}`).join("; ")}`,
			);
		}
	} finally {
		rmSync(output, { recursive: true, force: true });
	}
}

function runFixture(name) {
	if (name === "vite-root-base-contained") {
		runViteParserFixture({ base: "/" });
		return;
	}
	if (name === "vite-entry-root") {
		runViteParserFixture({ rootEscape: "entry" });
		return;
	}
	if (name === "vite-mounted-dot-segment-literal") {
		runViteParserFixture({ dotSegmentEscape: "literal" });
		return;
	}
	if (name === "vite-mounted-dot-segment-encoded") {
		runViteParserFixture({ dotSegmentEscape: "encoded" });
		return;
	}
	if (name === "next-entry-root") {
		runNextParserFixture({ rootEscape: "entry" });
		return;
	}
	if (name === "worker-root") {
		runViteParserFixture({ rootEscape: "transcription-worker" });
		return;
	}
	if (name === "editor-wasm-root") {
		runViteParserFixture({ rootEscape: "editor-wasm" });
		return;
	}
	if (name === "ort-root") {
		runViteParserFixture({ rootEscape: "ort-sidecar" });
		return;
	}
	if (name === "empty-graph") {
		runViteParserFixture({ empty: true });
		return;
	}
	if (name === "truncated-graph") {
		runViteParserFixture({ truncated: true });
		return;
	}
	if (name === "orphan-next-layers") {
		runNextParserFixture({ disconnected: true });
		return;
	}
	if (name === "deleted-reachable-next-file") {
		runNextParserFixture({ deletedReachable: true });
		return;
	}
	if (name === "next-entry-parser-root") {
		runNextParserFixture({ rootEscape: "entry" });
		return;
	}
	if (name === "next-worker-parser-root") {
		runNextParserFixture({ rootEscape: "transcription-worker" });
		return;
	}
	if (name === "next-editor-wasm-parser-root") {
		runNextParserFixture({ rootEscape: "editor-wasm" });
		return;
	}
	if (name === "next-ort-parser-root") {
		runNextParserFixture({ rootEscape: "ort-sidecar" });
		return;
	}
	if (name === "mixed-next-root-escapes") {
		runNextParserFixture({ contained: false });
		return;
	}
	if (name === "next-contained") {
		runNextParserFixture();
		return;
	}
	if (name === "next-root-base-shared-entry") {
		runNextParserFixture({ base: "/", sharedEntryWorkerWasm: true });
		return;
	}
	if (name === "relative-lazy-deleted") {
		runNextParserFixture({ deletedRelativeLazy: true });
		return;
	}
	if (name === "relative-css-base-escape") {
		runNextParserFixture({ relativeCssEscape: true });
		return;
	}
	if (name === "relative-css-media-deleted") {
		runNextParserFixture({ deletedRelativeMedia: true });
		return;
	}
	if (name === "relative-css-output-escape") {
		runNextParserFixture({ relativeCssOutputEscape: true });
		return;
	}
	if (name === "relative-css-static-escape") {
		runNextParserFixture({ relativeCssStaticEscape: true });
		return;
	}
	if (name === "relative-lazy-root-escape") {
		runNextParserFixture({ relativeLazyRootEscape: true });
		return;
	}
	if (name === "relative-lazy-static-escape") {
		runNextParserFixture({ relativeLazyStaticEscape: true });
		return;
	}
	if (name === "direct-entry-ort") {
		runNextParserFixture({ directEntryOrt: true });
		return;
	}
	if (name === "unrelated-editor-wasm") {
		runNextParserFixture({ unrelatedEditorWasm: true });
		return;
	}
	throw new Error(`Unknown emitted fixture: ${name}`);
}

function runPositiveControl() {
	console.log("check-emitted-runtime-assets: positive control");
	for (const fixture of [
		"next-contained",
		"next-root-base-shared-entry",
		"vite-root-base-contained",
	]) {
		const result = spawnSync(process.execPath, [SCRIPT, "--fixture", fixture], {
			encoding: "utf8",
		});
		process.stdout.write(result.stdout);
		process.stderr.write(result.stderr);
		if (result.status !== 0) process.exit(result.status ?? 1);
	}
	console.log(
		"positive control clean — a base-contained entry -> Worker -> ORT and entry -> editor-WASM graph passes; unrelated server output is excluded.",
	);
}

function runNegativeControl() {
	const fixtures = [
		["vite-entry-root", "root-emitted-entry-url"],
		[
			"vite-mounted-dot-segment-literal",
			"root-emitted-entry-url",
			["file=assets/entry.js", "url=/c4-vite/../assets/entry.js"],
		],
		[
			"vite-mounted-dot-segment-encoded",
			"root-emitted-entry-url",
			["file=assets/entry.js", "url=/c4-vite/%2e%2e/assets/entry.js"],
		],
		["next-entry-root", "root-next-entry-url"],
		["worker-root", "root-worker-url"],
		["editor-wasm-root", "root-editor-wasm-url"],
		["ort-root", "root-ort-sidecar-url"],
		["empty-graph", "empty-emitted-graph"],
		["truncated-graph", "missing-emitted-layer"],
		[
			"orphan-next-layers",
			"missing-emitted-layer",
			["layer=transcription-worker", "layer=ort-sidecar"],
		],
		[
			"deleted-reachable-next-file",
			"missing-reachable-next-file",
			["file=static/chunks/transcription-worker.js"],
		],
		[
			"next-entry-parser-root",
			"root-next-entry-url",
			[
				"file=server/app/editor/[project_id]/page_client-reference-manifest.js",
				"layer=entry",
			],
		],
		[
			"next-worker-parser-root",
			"root-worker-url",
			["file=static/chunks/good-entry.js", "layer=transcription-worker"],
		],
		[
			"next-editor-wasm-parser-root",
			"root-editor-wasm-url",
			["file=static/chunks/good-entry.js", "layer=editor-wasm"],
		],
		[
			"next-ort-parser-root",
			"root-ort-sidecar-url",
			["file=static/chunks/transcription-worker.js", "layer=ort-sidecar"],
		],
		[
			"mixed-next-root-escapes",
			"root-next-entry-url",
			[
				"file=server/app/editor/[project_id]/page_client-reference-manifest.js",
				"file=server/app/editor/[project_id]/page.html",
				"file=server/app/editor/[project_id]/editor.css",
				"url=/flags/root-css.png",
			],
		],
		["relative-lazy-deleted", "missing-reachable-next-file"],
		[
			"relative-lazy-root-escape",
			"root-emitted-entry-url",
			["file=static/chunks/lazy-relative.mjs"],
		],
		[
			"relative-lazy-static-escape",
			"relative-next-static-escape",
			["file=static/chunks/good-entry.js"],
		],
		[
			"relative-css-media-deleted",
			"missing-reachable-next-file",
			["file=static/media/font.woff2"],
		],
		["relative-css-base-escape", "relative-public-base-escape"],
		["relative-css-output-escape", "relative-next-output-escape"],
		["relative-css-static-escape", "relative-next-static-escape"],
		["direct-entry-ort", "missing-runtime-topology"],
		["unrelated-editor-wasm", "missing-emitted-layer", ["layer=editor-wasm"]],
	];
	console.log("check-emitted-runtime-assets: negative control");
	let failed = false;
	for (const [name, rule, requiredFragments = []] of fixtures) {
		const result = spawnSync(process.execPath, [SCRIPT, "--fixture", name], {
			encoding: "utf8",
		});
		const output = `${result.stdout}${result.stderr}`;
		const passed =
			result.status !== 0 &&
			output.includes(`[${rule}]`) &&
			output.includes("file=") &&
			output.includes("layer=") &&
			output.includes("url=") &&
			requiredFragments.every((fragment) => output.includes(fragment));
		console.log(
			`  ${passed ? "PASS" : "FAIL"} ${name}: non-zero [${rule}] with file/layer/url`,
		);
		failed ||= !passed;
	}
	if (failed) process.exit(1);
	console.log(
		"negative control clean — every emitted violation fails closed and is attributable.",
	);
}

function runSourceCheck() {
	const result = spawnSync(process.execPath, [SOURCE_CHECK], {
		cwd: REPO_ROOT,
		encoding: "utf8",
	});
	process.stdout.write(result.stdout);
	process.stderr.write(result.stderr);
	if (result.status !== 0) process.exit(result.status ?? 1);
}

function runCheck() {
	runSourceCheck();
	const viteOutput = resolve(
		REPO_ROOT,
		option("--vite-output", "apps/vite-example/dist"),
	);
	const nextOutput = resolve(
		REPO_ROOT,
		option("--next-output", "apps/web/.next"),
	);
	const viteBase = normalizeBase(option("--vite-base", "/"), true);
	const nextBase = normalizeBase(option("--next-base", "/"), true);
	const reports = [
		{
			host: "vite",
			base: viteBase,
			output: viteOutput,
			...viteInventory(viteOutput, viteBase),
		},
		{
			host: "next",
			base: nextBase,
			output: nextOutput,
			...nextInventory(nextOutput, nextBase),
		},
	];
	const violations = [];
	for (const report of reports) {
		violations.push(...acceptanceViolations(report));
		const counts = REQUIRED_LAYERS.map(
			(layer) =>
				`${layer}=${report.entries.filter((entry) => entry.layer === layer).length}`,
		).join(", ");
		console.log(
			`emitted ${report.host}: output=${report.output} base=${report.base} ${counts}`,
		);
	}
	if (violations.length > 0) {
		for (const item of violations) printViolation(item);
		process.exit(1);
	}
	const inventory = {
		generatedBy: "script/check-emitted-runtime-assets.mjs",
		hosts: reports.map((report) => ({
			host: report.host,
			base: report.base,
			output: report.output,
			manifest: report.manifestPath,
			files: report.entries,
			...(report.visitedNodes ? { visitedNodes: report.visitedNodes } : {}),
			...(report.edges ? { edges: report.edges } : {}),
			...(report.topology ? { topology: report.topology } : {}),
		})),
	};
	const inventoryOutput = option("--inventory-output");
	if (inventoryOutput) {
		const resolved = resolve(REPO_ROOT, inventoryOutput);
		writeFileSync(resolved, `${JSON.stringify(inventory, null, 2)}\n`);
		console.log(`inventory=${resolved}`);
	}
	console.log(
		"clean — both Host roots and every entry/Worker/editor-WASM/ORT emitted layer are non-empty and base-contained.",
	);
}

const fixtureIndex = process.argv.indexOf("--fixture");
if (fixtureIndex >= 0) runFixture(process.argv[fixtureIndex + 1]);
else if (process.argv.includes("--positive-control")) runPositiveControl();
else if (process.argv.includes("--negative-control")) runNegativeControl();
else runCheck();

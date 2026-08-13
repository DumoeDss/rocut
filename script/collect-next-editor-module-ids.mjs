import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const NEXT_EDITOR_ROUTE = "/editor/[project_id]/page";

function slash(value) {
	return value.replaceAll("\\", "/");
}

export function sha256File(filePath) {
	return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

export function canonicalStringSetDigest(values) {
	const canonical = [
		...new Set(values.map((value) => slash(String(value)))),
	].sort();
	return {
		count: canonical.length,
		sha256: createHash("sha256")
			.update(JSON.stringify(canonical))
			.digest("hex"),
	};
}

export function canonicalFileSetDigest({ files, repositoryRoot }) {
	const canonical = [...new Set(files.map((filePath) => resolve(filePath)))]
		.map((filePath) => ({
			path: slash(relative(repositoryRoot, filePath)),
			sha256: sha256File(filePath),
		}))
		.sort((left, right) => left.path.localeCompare(right.path));
	return {
		count: canonical.length,
		sha256: createHash("sha256")
			.update(JSON.stringify(canonical))
			.digest("hex"),
	};
}

function stripSemicolon(value) {
	const trimmed = value.trim();
	return trimmed.endsWith(";") ? trimmed.slice(0, -1).trim() : trimmed;
}

function parseRouteManifest(text) {
	const marker = `globalThis.__RSC_MANIFEST[${JSON.stringify(NEXT_EDITOR_ROUTE)}]`;
	const markerIndex = text.indexOf(marker);
	if (markerIndex < 0) {
		throw new Error(`Next route manifest is missing ${NEXT_EDITOR_ROUTE}`);
	}
	const assignment = text.indexOf("=", markerIndex + marker.length);
	if (assignment < 0) {
		throw new Error(
			`Next route manifest has no assignment for ${NEXT_EDITOR_ROUTE}`,
		);
	}
	try {
		return JSON.parse(stripSemicolon(text.slice(assignment + 1)));
	} catch (error) {
		throw new Error(
			`Next route manifest is not valid JSON for ${NEXT_EDITOR_ROUTE}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

function sourceModuleId(source, mapPath, repositoryRoot) {
	const raw = slash(String(source));
	const appMatch = raw.match(
		/(?:^|\/)(apps\/(?:web|vite-example)\/src\/[^?#]+)$/,
	);
	if (appMatch) return appMatch[1];

	const absolute = resolve(dirname(mapPath), raw);
	const repoRelative = slash(relative(repositoryRoot, absolute));
	if (repoRelative.startsWith("apps/web/src/")) return repoRelative;
	if (repoRelative.startsWith("apps/vite-example/src/")) return repoRelative;
	return repoRelative;
}

function resolveReferencedFile(baseDir, reference) {
	if (typeof reference !== "string" || reference.length === 0) return null;
	if (reference.startsWith("data:")) return null;
	const decoded = decodeURIComponent(reference.split("#", 1)[0]);
	return resolve(baseDir, decoded.replace(/^\/+/, ""));
}

function addExistingFile(files, filePath, missingFiles) {
	if (!filePath) return;
	if (existsSync(filePath)) files.add(filePath);
	else missingFiles.add(filePath);
}

function addRouteChunkReferences({ distDir, manifest, files, missingFiles }) {
	const entryKey = Object.keys(manifest.entryJSFiles ?? {}).find((key) =>
		key.endsWith("/apps/web/src/app/editor/[project_id]/page"),
	);
	if (!entryKey) {
		throw new Error(
			`Next route manifest has no exact editor entryJSFiles key for ${NEXT_EDITOR_ROUTE}`,
		);
	}

	for (const chunk of manifest.entryJSFiles[entryKey] ?? []) {
		if (typeof chunk !== "string") continue;
		addExistingFile(
			files,
			join(distDir, chunk.replace(/^\/+/, "")),
			missingFiles,
		);
	}

	const routeClientIds = new Set(
		Object.entries(manifest.clientModules ?? {})
			.filter(
				([moduleId]) =>
					moduleId.startsWith("[project]/") &&
					(moduleId.includes("/apps/web/src/app/editor/[project_id]/page") ||
						moduleId.includes("/apps/web/src/app/layout")),
			)
			.map(([, module]) => String(module?.id))
			.filter((id) => id !== "undefined"),
	);
	for (const moduleId of routeClientIds) {
		for (const mappingName of ["ssrModuleMapping", "rscModuleMapping"]) {
			const mapping = manifest[mappingName]?.[moduleId];
			for (const value of Object.values(mapping ?? {})) {
				for (const chunk of value?.chunks ?? []) {
					if (typeof chunk !== "string") continue;
					addExistingFile(
						files,
						join(distDir, chunk.replace(/^\/+/, "")),
						missingFiles,
					);
				}
			}
		}
	}
}

function addSourceMap({
	filePath,
	repositoryRoot,
	mapFiles,
	missingMaps,
	moduleIds,
}) {
	let text;
	try {
		text = readFileSync(filePath, "utf8");
	} catch {
		return;
	}
	for (const match of text.matchAll(
		/(?:^|\n)\s*\/\/# sourceMappingURL=([^\s]+)/g,
	)) {
		const reference = match[1];
		if (reference.startsWith("data:")) {
			const comma = reference.indexOf(",");
			if (comma < 0) continue;
			try {
				const encoded = reference.slice(comma + 1);
				const mapText = reference.slice(0, comma).includes(";base64")
					? Buffer.from(encoded, "base64").toString("utf8")
					: decodeURIComponent(encoded);
				const map = JSON.parse(mapText);
				for (const source of map.sources ?? []) {
					moduleIds.add(sourceModuleId(source, filePath, repositoryRoot));
				}
			} catch {
				// A malformed inline map is handled by the non-empty map/source checks.
			}
			continue;
		}
		const mapPath = resolveReferencedFile(dirname(filePath), reference);
		if (!mapPath) continue;
		if (!existsSync(mapPath)) {
			missingMaps.add(mapPath);
			continue;
		}
		mapFiles.add(mapPath);
		try {
			const map = JSON.parse(readFileSync(mapPath, "utf8"));
			for (const source of map.sources ?? []) {
				moduleIds.add(sourceModuleId(source, mapPath, repositoryRoot));
			}
		} catch {
			// Keep the map attributable, then let the caller reject a zero-source map
			// inventory rather than silently treating malformed output as complete.
		}
	}
}

/**
 * Collect the exact module/file set attributable to Next's production editor
 * route. The route NFT provides server reachability; the client-reference
 * manifest provides browser entry chunks; source maps resolve those emitted
 * chunks back to repository module IDs. No undocumented `.next/module-graph`
 * file is assumed.
 */
export function collectNextEditorModuleIds({ distDir, repositoryRoot }) {
	const absoluteDist = resolve(repositoryRoot, distDir);
	const routeDir = join(
		absoluteDist,
		"server",
		"app",
		"editor",
		"[project_id]",
	);
	const manifestPath = join(routeDir, "page_client-reference-manifest.js");
	const nftPath = join(routeDir, "page.js.nft.json");
	const routePagePath = join(routeDir, "page.js");
	const missingFiles = new Set();
	const missingMaps = new Set();
	if (!existsSync(manifestPath)) {
		throw new Error(`Next editor route manifest is missing: ${manifestPath}`);
	}
	if (!existsSync(nftPath)) {
		throw new Error(`Next editor route NFT is missing: ${nftPath}`);
	}
	if (!existsSync(routePagePath)) {
		throw new Error(`Next editor route entry is missing: ${routePagePath}`);
	}

	const manifest = parseRouteManifest(readFileSync(manifestPath, "utf8"));
	const files = new Set([routePagePath, manifestPath]);
	const nft = JSON.parse(readFileSync(nftPath, "utf8"));
	if (!Array.isArray(nft.files) || nft.files.length === 0) {
		throw new Error(`Next editor route NFT is empty: ${nftPath}`);
	}
	for (const file of nft.files) {
		if (typeof file !== "string" || !file.endsWith(".js")) continue;
		addExistingFile(files, resolve(routeDir, file), missingFiles);
	}
	addRouteChunkReferences({
		distDir: absoluteDist,
		manifest,
		files,
		missingFiles,
	});

	const mapFiles = new Set();
	const moduleIds = new Set();
	for (const moduleId of Object.keys(manifest.clientModules ?? {})) {
		const normalized = moduleId.replace(/ <module evaluation>$/, "");
		const appMatch = normalized.match(
			/(?:^|\/)(apps\/(?:web|vite-example)\/src\/[^?#]+)$/,
		);
		if (appMatch) moduleIds.add(appMatch[1]);
	}
	for (const filePath of files) {
		if (filePath.endsWith(".js")) {
			addSourceMap({
				filePath,
				repositoryRoot,
				mapFiles,
				missingMaps,
				moduleIds,
			});
		}
	}

	const sourceModuleIds = [...moduleIds].filter(
		(moduleId) =>
			moduleId.startsWith("apps/web/src/") ||
			moduleId.startsWith("apps/vite-example/src/"),
	);
	return {
		absoluteDist,
		routeDir,
		manifestPath,
		nftPath,
		routePagePath,
		files: [...files],
		mapFiles: [...mapFiles],
		moduleIds: [...moduleIds],
		sourceModuleIds,
		missingFiles: [...missingFiles],
		missingMaps: [...missingMaps],
		buildId: existsSync(join(absoluteDist, "BUILD_ID"))
			? readFileSync(join(absoluteDist, "BUILD_ID"), "utf8").trim()
			: null,
	};
}

export function summarizeNextEditorModules(inventory) {
	return {
		files: inventory.files.length,
		maps: inventory.mapFiles.length,
		moduleIds: inventory.moduleIds.length,
		sourceModuleIds: inventory.sourceModuleIds.length,
		missingFiles: inventory.missingFiles.length,
		missingMaps: inventory.missingMaps.length,
	};
}

export function collectNextEditorArtifactDigests({
	inventory,
	repositoryRoot,
}) {
	const buildIdPath = join(inventory.absoluteDist, "BUILD_ID");
	return {
		nftSha256: sha256File(inventory.nftPath),
		routePageSha256: sha256File(inventory.routePagePath),
		routeManifestSha256: sha256File(inventory.manifestPath),
		routeFiles: canonicalFileSetDigest({
			files: inventory.files,
			repositoryRoot,
		}),
		sourceMaps: canonicalFileSetDigest({
			files: inventory.mapFiles,
			repositoryRoot,
		}),
		moduleIds: canonicalStringSetDigest(inventory.moduleIds),
		sourceModuleIds: canonicalStringSetDigest(inventory.sourceModuleIds),
		buildIdSha256: existsSync(buildIdPath) ? sha256File(buildIdPath) : null,
	};
}

if (
	process.argv[1] &&
	basename(process.argv[1]) === basename(import.meta.url)
) {
	const distDir = process.argv[2];
	if (!distDir) {
		console.error(
			"usage: node script/collect-next-editor-module-ids.mjs <next-dist>",
		);
		process.exit(2);
	}
	const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
	try {
		const inventory = collectNextEditorModuleIds({ distDir, repositoryRoot });
		console.log(JSON.stringify(summarizeNextEditorModules(inventory), null, 2));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}

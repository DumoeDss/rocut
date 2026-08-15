#!/usr/bin/env node
/**
 * Produce a review candidate for the frozen C6 source closure and its
 * independent artifact anchor. This command only writes JSON to stdout: it
 * never edits or blesses the fixture consumed by the ordinary checker.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	canonicalStringSetDigest,
	collectNextEditorArtifactDigests,
	collectNextEditorModuleIds,
	sha256File,
} from "./collect-next-editor-module-ids.mjs";

const REQUIRED_ROOTS = [
	"components/editor",
	"preview",
	"selection",
	"timeline",
	"sounds",
	"export",
	"utils",
	"core",
	"editor",
	"media",
	"retime",
	"services/renderer",
	"services/transcription",
	"services/video-cache",
	"services/waveform-cache",
];
const HOST_ENTRIES = {
	vite: [
		"apps/vite-example/src/host/vite-host-config.ts",
		"packages/editor-classic/src/editor/session/create-session.ts",
	],
	next: [
		"apps/web/src/editor/host/next-editor-host.ts",
		"packages/editor-classic/src/editor/session/create-session.ts",
	],
};

/**
 * S05 P1 Stage C moved the editor runtime graph out of apps/web/src into
 * @opencut/editor-classic and @opencut/editor-ports. Kept in sync by hand
 * with the identically-named helper in check-session-resource-boundary.mjs —
 * both scripts need to agree on what counts as shared editor-package source
 * as opposed to a Host's own wrapper code.
 */
const EDITOR_PACKAGE_PREFIXES = [
	"packages/editor-classic/src/",
	"packages/editor-ports/src/",
];
function isEditorPackageModule(moduleId) {
	return EDITOR_PACKAGE_PREFIXES.some((prefix) => moduleId.startsWith(prefix));
}

function slash(value) {
	return value.replaceAll("\\", "/");
}

function repositoryPath({ repositoryRoot, filePath }) {
	return slash(relative(repositoryRoot, resolve(filePath)));
}

function isRequiredSource(moduleId) {
	return REQUIRED_ROOTS.some(
		(root) =>
			moduleId === `packages/editor-classic/src/${root}` ||
			moduleId.startsWith(`packages/editor-classic/src/${root}/`),
	);
}

function canonicalPayloadSha256({ requiredRoots, common, hosts }) {
	return createHash("sha256")
		.update(JSON.stringify({ requiredRoots, common, hosts }))
		.digest("hex");
}

function assertEveryRoot({ name, moduleIds }) {
	const missing = REQUIRED_ROOTS.filter(
		(root) =>
			!moduleIds.some((moduleId) =>
				moduleId.startsWith(`packages/editor-classic/src/${root}/`),
			),
	);
	if (missing.length > 0) {
		throw new Error(`${name} omitted required roots: ${missing.join(", ")}`);
	}
}

function parseViteInventory({ viteDist, repositoryRoot }) {
	const moduleGraphPath = join(viteDist, "module-graph.json");
	const assetManifestPath = join(viteDist, "asset-manifest.json");
	if (!existsSync(moduleGraphPath) || !existsSync(assetManifestPath)) {
		throw new Error(`Vite provenance artifacts are incomplete: ${viteDist}`);
	}
	const graph = JSON.parse(readFileSync(moduleGraphPath, "utf8"));
	if (!Array.isArray(graph.modules) || graph.modules.length === 0) {
		throw new Error(`Vite module graph is empty: ${moduleGraphPath}`);
	}
	const moduleIds = [
		...new Set(graph.modules.map((moduleId) => slash(moduleId))),
	];
	const sourceModuleIds = moduleIds.filter(
		(moduleId) =>
			isEditorPackageModule(moduleId) ||
			moduleId.startsWith("apps/vite-example/src/"),
	);
	return {
		moduleGraphPath,
		assetManifestPath,
		moduleIds,
		sourceModuleIds,
		anchor: {
			dist: repositoryPath({ repositoryRoot, filePath: viteDist }),
			moduleGraph: repositoryPath({
				repositoryRoot,
				filePath: moduleGraphPath,
			}),
			moduleGraphSha256: sha256File(moduleGraphPath),
			assetManifest: repositoryPath({
				repositoryRoot,
				filePath: assetManifestPath,
			}),
			assetManifestSha256: sha256File(assetManifestPath),
			moduleIds: canonicalStringSetDigest(moduleIds),
			webSourceModuleIds: canonicalStringSetDigest(
				sourceModuleIds.filter((moduleId) => isEditorPackageModule(moduleId)),
			),
			attributableSourceModuleIds: canonicalStringSetDigest(sourceModuleIds),
		},
	};
}

export function generateSessionResourceClosureCandidate({
	repositoryRoot,
	viteDist,
	nextDist,
}) {
	const absoluteRoot = resolve(repositoryRoot);
	const absoluteVite = resolve(absoluteRoot, viteDist);
	const absoluteNext = resolve(absoluteRoot, nextDist);
	const vite = parseViteInventory({
		viteDist: absoluteVite,
		repositoryRoot: absoluteRoot,
	});
	const next = collectNextEditorModuleIds({
		distDir: absoluteNext,
		repositoryRoot: absoluteRoot,
	});
	if (next.missingFiles.length > 0 || next.missingMaps.length > 0) {
		throw new Error(
			"Next provenance inventory contains missing route files/maps",
		);
	}

	const viteRequired = vite.sourceModuleIds.filter(isRequiredSource).sort();
	const nextRequired = next.sourceModuleIds.filter(isRequiredSource).sort();
	assertEveryRoot({ name: "Vite", moduleIds: viteRequired });
	assertEveryRoot({ name: "Next", moduleIds: nextRequired });
	const viteSet = new Set(viteRequired);
	const nextSet = new Set(nextRequired);
	const common = viteRequired.filter((moduleId) => nextSet.has(moduleId));
	const hosts = {
		vite: {
			entries: HOST_ENTRIES.vite,
			additional: viteRequired.filter((moduleId) => !nextSet.has(moduleId)),
		},
		next: {
			entries: HOST_ENTRIES.next,
			additional: nextRequired.filter((moduleId) => !viteSet.has(moduleId)),
		},
	};
	const payloadSha256 = canonicalPayloadSha256({
		requiredRoots: REQUIRED_ROOTS,
		common,
		hosts,
	});
	const nextDigests = collectNextEditorArtifactDigests({
		inventory: next,
		repositoryRoot: absoluteRoot,
	});
	const head = execFileSync("git", ["rev-parse", "HEAD"], {
		cwd: absoluteRoot,
		encoding: "utf8",
	}).trim();
	const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
		cwd: absoluteRoot,
		encoding: "utf8",
	}).trim();
	const anchorPath = "script/fixtures/c6-session-resource-closure-anchor.json";
	const closure = {
		schemaVersion: 2,
		provenance: {
			reviewedAt: new Date().toISOString().slice(0, 10),
			baseCommit: head,
			baseTree: tree,
			method:
				"Reviewed union of attributable sourceModuleIds from the named fresh Vite module graph and Next editor-route NFT/source maps.",
			anchor: anchorPath,
			vite: {
				artifact: vite.anchor.moduleGraph,
				sha256: vite.anchor.moduleGraphSha256,
			},
			next: {
				artifact: repositoryPath({
					repositoryRoot: absoluteRoot,
					filePath: next.nftPath,
				}),
				buildId: next.buildId,
				sha256: nextDigests.nftSha256,
			},
		},
		integrity: {
			algorithm: "sha256",
			canonicalPayload: "JSON.stringify({ requiredRoots, common, hosts })",
			canonicalPayloadSha256: payloadSha256,
			reviewedCommonSourceCount: common.length,
		},
		requiredRoots: REQUIRED_ROOTS,
		common,
		hosts,
	};
	const sourceClosure = [
		...new Set([
			...common,
			...Object.values(hosts).flatMap((host) => [
				...host.additional,
				...host.entries.filter((entry) => isEditorPackageModule(entry)),
			]),
		]),
	].sort();
	const anchor = {
		schemaVersion: 1,
		policy:
			"Review this file independently from checker and mutable closure fixture changes.",
		closure: {
			canonicalPayloadSha256: payloadSha256,
			commonSourceCount: common.length,
			sourceClosureCount: sourceClosure.length,
			sourceClosureSha256: canonicalStringSetDigest(sourceClosure).sha256,
		},
		artifacts: {
			vite: vite.anchor,
			next: {
				dist: repositoryPath({
					repositoryRoot: absoluteRoot,
					filePath: absoluteNext,
				}),
				nft: repositoryPath({
					repositoryRoot: absoluteRoot,
					filePath: next.nftPath,
				}),
				nftSha256: nextDigests.nftSha256,
				routePageSha256: nextDigests.routePageSha256,
				routeManifestSha256: nextDigests.routeManifestSha256,
				routeFiles: nextDigests.routeFiles,
				sourceMaps: nextDigests.sourceMaps,
				moduleIds: nextDigests.moduleIds,
				sourceModuleIds: nextDigests.sourceModuleIds,
				observedBuildId: next.buildId,
				buildIdSha256: nextDigests.buildIdSha256,
			},
		},
	};
	return { closure, anchor };
}

function option(name) {
	const index = process.argv.indexOf(name);
	return index >= 0 ? process.argv[index + 1] : null;
}

if (
	process.argv[1] &&
	basename(process.argv[1]) === basename(import.meta.url)
) {
	const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
	const viteDist = option("--vite-dist");
	const nextDist = option("--next-dist");
	if (!viteDist || !nextDist) {
		console.error(
			"usage: node script/generate-session-resource-closure.mjs --vite-dist <dist> --next-dist <dist>",
		);
		process.exit(2);
	}
	try {
		console.log(
			JSON.stringify(
				generateSessionResourceClosureCandidate({
					repositoryRoot,
					viteDist,
					nextDist,
				}),
				null,
				2,
			),
		);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}

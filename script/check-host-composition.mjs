#!/usr/bin/env node
/**
 * Production Host composition gate (S02/C5).
 *
 * The in-memory bundle remains useful for non-browser roles, so this check does
 * not ban createInMemoryPorts wholesale. It proves that each browser Host
 * explicitly constructs one stable BrowserProjectStore and final-overrides the
 * inherited reference store. It also rejects the retired partial/resolver seam
 * and any parallel persistence acquisition path.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOST_ROOTS = [
	"apps/vite-example/src/host/vite-host-config.ts",
	"apps/web/src/editor/host/next-editor-host.ts",
];
const HOST_CONTRACT = "apps/web/src/editor/host/editor-host.ts";
const RETIRED_ADAPTER = "apps/web/src/services/storage/browser-host-adapter.ts";

function sourceFiles() {
	return execFileSync(
		"git",
		[
			"ls-files",
			"-z",
			"--cached",
			"--others",
			"--exclude-standard",
			"apps/web/src",
			"apps/vite-example/src",
		],
		{ cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
	)
		.split("\0")
		.filter(Boolean)
		.filter((path) => /\.(?:ts|tsx)$/.test(path))
		.filter((path) => !path.includes("/__tests__/"))
		.filter((path) => existsSync(join(REPO_ROOT, path)));
}

function stripComments(source) {
	return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function checkHost({ path, source }) {
	const violations = [];
	const code = stripComments(source);
	const factoryIndex = code.indexOf("export function create");
	const declaration =
		/const\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+BrowserProjectStore\s*\(\s*\{/.exec(
			code,
		);
	if (!declaration || declaration.index > factoryIndex) {
		violations.push({
			rule: "stable-explicit-browser-store",
			path,
			detail:
				"BrowserProjectStore must be a module-stable const before the Host factory",
		});
	}
	if (!/storageIdentity\s*:/.test(code)) {
		violations.push({
			rule: "explicit-durable-identity",
			path,
			detail: "BrowserProjectStore construction must name storageIdentity",
		});
	}
	const lastReferenceSpread = Math.max(
		code.lastIndexOf("...createInMemoryPorts"),
		code.lastIndexOf("...browser"),
	);
	const finalStore = declaration
		? new RegExp(`store\\s*:\\s*${declaration[1]}\\s*[,}]`, "m").exec(code)
		: null;
	if (!finalStore || finalStore.index < lastReferenceSpread) {
		violations.push({
			rule: "final-store-override",
			path,
			detail:
				"the stable browser store must be assigned after every reference/browser spread",
		});
	}
	if (/store\s*:\s*[^,\n]*(?:\?\?|\|\||\?[^:]*:)/.test(code)) {
		violations.push({
			rule: "no-store-fallback",
			path,
			detail: "production store composition must not use a fallback expression",
		});
	}
	if (/\bInMemoryProjectStore\b/.test(code)) {
		violations.push({
			rule: "no-production-in-memory-store",
			path,
			detail: "production Host names InMemoryProjectStore",
		});
	}
	if (/BrowserHostAdapter|browser-host-adapter|\bstorageService\b/.test(code)) {
		violations.push({
			rule: "no-retired-storage-path",
			path,
			detail:
				"production Host reaches a retired adapter or process-global service",
		});
	}
	return violations;
}

function checkContract({ path, source }) {
	const code = stripComments(source);
	const violations = [];
	if (
		!/interface\s+EditorHost\s+extends\s+EditorHostBase\s*,\s*EditorHostPorts/.test(
			code,
		)
	) {
		violations.push({
			rule: "required-complete-host",
			path,
			detail: "EditorHost must directly require EditorHostPorts",
		});
	}
	const hasRequiredIdentityAlias =
		/export\s+type\s+ResolvedEditorHost\s*=\s*EditorHost\s*;/.test(code);
	const hasIdentityResolver =
		/function\s+resolveEditorHost\s*\([^)]*\)\s*:\s*ResolvedEditorHost\s*\{\s*return\s+args\.host\s*;\s*\}/s.test(
			code,
		);
	if (
		/Partial\s*<\s*EditorHostPorts|\bas\s+ResolvedEditorHost\b/.test(code) ||
		!hasRequiredIdentityAlias ||
		!hasIdentityResolver
	) {
		violations.push({
			rule: "no-optional-resolution",
			path,
			detail:
				"the protected resolver must be an identity over required EditorHost with no partial form or cast",
		});
	}
	if (
		/\b(?:projectStore|mediaStore|storage|storagePort|mediaPort|mediaStorage|persistence|persistenceStore)\??\s*:/.test(
			code,
		)
	) {
		violations.push({
			rule: "no-parallel-host-storage",
			path,
			detail:
				"EditorHost may expose persistence and durable media only through store",
		});
	}
	return violations;
}

function checkGraph({ files }) {
	const violations = [];
	for (const path of files) {
		const absolute = join(REPO_ROOT, path);
		if (!existsSync(absolute)) continue;
		const source = readFileSync(absolute, "utf8");
		const code = stripComments(source);
		if (/browser-host-adapter|\bBrowserHostAdapter\b/.test(code)) {
			violations.push({
				rule: "no-adapter-resurrection",
				path,
				detail: "retired browser Host adapter reference",
			});
		}
		if (
			/import\s*\{[^}]*\bstorageService\b[^}]*\}\s*from|export\s+const\s+storageService\b/.test(
				code,
			)
		) {
			violations.push({
				rule: "no-process-global-storage",
				path,
				detail:
					"production graph exposes or imports process-global storageService",
			});
		}
		if (
			/createContext\s*<[^>]*(?:ProjectStore|StoragePort|MediaStore|MediaPort|MediaStoragePort|SessionPersistenceCoordinator|EditorHostPorts)/s.test(
				code,
			)
		) {
			violations.push({
				rule: "no-private-storage-context",
				path,
				detail:
					"storage/coordinator roles must arrive through the owning session",
			});
		}
		if (
			!path.startsWith("apps/web/src/services/storage/") &&
			/\b(?:interface|type|class)\s+(?:StoragePort|MediaStore|MediaPort|MediaStoragePort)\b/.test(
				code,
			)
		) {
			violations.push({
				rule: "no-second-storage-media-port",
				path,
				detail:
					"ProjectStore is the only storage/media persistence port in the production graph",
			});
		}
		if (path === "apps/web/src/editor/ports/index.ts") {
			const portBody =
				/interface\s+EditorHostPorts\s*\{([\s\S]*?)\}/.exec(code)?.[1] ?? "";
			if (
				/\b(?:projectStore|mediaStore|storage|storagePort|mediaPort|mediaStorage|persistence|persistenceStore)\??\s*:/.test(
					portBody,
				)
			) {
				violations.push({
					rule: "no-second-storage-media-port",
					path,
					detail:
						"EditorHostPorts may expose durable storage/media only through store",
				});
			}
		}
	}
	return violations;
}

function runNegativeControl() {
	const validHost = `
		import { BrowserProjectStore } from "store";
		const durableStore = new BrowserProjectStore({ storageIdentity: identity });
		export function createHost() {
			return { ...createInMemoryPorts(), ...browser, store: durableStore };
		}
	`;
	const fixtures = [
		{
			rule: "stable-explicit-browser-store",
			kind: "host",
			source: `export function createHost() { const store = new BrowserProjectStore({ storageIdentity: identity }); return { store }; }`,
		},
		{
			rule: "final-store-override",
			kind: "host",
			source: `const durableStore = new BrowserProjectStore({ storageIdentity: identity }); export function createHost() { return { store: durableStore, ...createInMemoryPorts(), ...browser }; }`,
		},
		{
			rule: "no-store-fallback",
			kind: "host",
			source: validHost.replace(
				"store: durableStore",
				"store: configured ?? inMemory",
			),
		},
		{
			rule: "no-production-in-memory-store",
			kind: "host",
			source: `${validHost}\nvoid InMemoryProjectStore;`,
		},
		{
			rule: "no-retired-storage-path",
			kind: "host",
			source: `${validHost}\nvoid BrowserHostAdapter;`,
		},
		{
			rule: "required-complete-host",
			kind: "contract",
			source: "export interface EditorHost extends EditorHostBase {}",
		},
		{
			rule: "no-optional-resolution",
			kind: "contract",
			source:
				"export interface EditorHost extends EditorHostBase, Partial<EditorHostPorts> {}",
		},
		{
			rule: "no-parallel-host-storage",
			kind: "contract",
			source:
				"export interface EditorHost extends EditorHostBase, EditorHostPorts { mediaStore: MediaPort }",
		},
		{
			rule: "no-private-storage-context",
			kind: "graph",
			source: "const Hidden = createContext<StoragePort | null>(null);",
		},
		{
			rule: "no-second-storage-media-port",
			kind: "graph",
			source: "export interface StoragePort { load(): Promise<unknown> }",
		},
		{
			rule: "no-second-storage-media-port",
			kind: "graph",
			source: "export interface MediaPort { load(): Promise<ArrayBuffer> }",
		},
		{
			rule: "no-process-global-storage",
			kind: "graph",
			source: 'import { storageService } from "@/services/storage/service";',
		},
	];
	let clean = true;
	console.log("check-host-composition: negative control");
	for (const fixture of fixtures) {
		let hits;
		if (fixture.kind === "host") {
			hits = checkHost({ path: "fixture-host.ts", source: fixture.source });
		} else if (fixture.kind === "contract") {
			hits = checkContract({
				path: "fixture-editor-host.ts",
				source: fixture.source,
			});
		} else if (fixture.rule === "no-private-storage-context") {
			const code = stripComments(fixture.source);
			hits =
				/createContext\s*<[^>]*(?:ProjectStore|StoragePort|MediaStore|MediaPort|MediaStoragePort|SessionPersistenceCoordinator|EditorHostPorts)/s.test(
					code,
				)
					? [{ rule: "no-private-storage-context" }]
					: [];
		} else if (fixture.rule === "no-second-storage-media-port") {
			const code = stripComments(fixture.source);
			hits =
				/\b(?:interface|type|class)\s+(?:StoragePort|MediaStore|MediaPort|MediaStoragePort)\b/.test(
					code,
				)
					? [{ rule: "no-second-storage-media-port" }]
					: [];
		} else {
			const code = stripComments(fixture.source);
			hits =
				/import\s*\{[^}]*\bstorageService\b[^}]*\}\s*from|export\s+const\s+storageService\b/.test(
					code,
				)
					? [{ rule: "no-process-global-storage" }]
					: [];
		}
		const caught = hits.some((hit) => hit.rule === fixture.rule);
		if (!caught) clean = false;
		console.log(`  ${caught ? "PASS" : "FAIL"}  ${fixture.rule}`);
	}
	if (!clean) process.exit(1);
	console.log("\nPASS  every composition rule is proven able to fail");
}

function runCheck() {
	const files = sourceFiles();
	const violations = [];
	for (const path of HOST_ROOTS) {
		violations.push(
			...checkHost({
				path,
				source: readFileSync(join(REPO_ROOT, path), "utf8"),
			}),
		);
	}
	violations.push(
		...checkContract({
			path: HOST_CONTRACT,
			source: readFileSync(join(REPO_ROOT, HOST_CONTRACT), "utf8"),
		}),
		...checkGraph({ files }),
	);
	if (existsSync(join(REPO_ROOT, RETIRED_ADAPTER))) {
		violations.push({
			rule: "no-adapter-resurrection",
			path: RETIRED_ADAPTER,
			detail: "retired adapter file still exists",
		});
	}

	console.log(
		`check-host-composition: scanned ${HOST_ROOTS.length} Host roots and ${files.length} production modules`,
	);
	for (const violation of violations) {
		console.error(
			`  FAIL  [${violation.rule}] ${violation.path}: ${violation.detail}`,
		);
	}
	if (violations.length > 0) process.exit(1);
	console.log(
		"  PASS  stable explicit browser stores are the final Host override",
	);
	console.log(
		"  PASS  EditorHost is required; its protected resolver is identity-only",
	);
	console.log(
		"  PASS  no retired adapter, process-global storage or private persistence context exists",
	);
}

if (process.argv.includes("--negative-control")) runNegativeControl();
else runCheck();

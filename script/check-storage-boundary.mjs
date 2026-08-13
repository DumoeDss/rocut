#!/usr/bin/env node
/**
 * Final browser-persistence boundary gate (S02/C5).
 *
 * The gate inventories every production source module plus three exact
 * persistence verification fixtures. It reports dependency leaks separately
 * from browser-mechanism calls: deleting a singleton import does not prove that
 * a consumer stopped calling IndexedDB directly, and vice versa.
 *
 *   node script/check-storage-boundary.mjs
 *   node script/check-storage-boundary.mjs --fixture <fixture-root>
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_ROOTS = ["apps/web/src", "apps/vite-example/src"];
const STORAGE_AREA = "apps/web/src/services/storage/";
const PUBLIC_PORT_AREA = "apps/web/src/editor/ports/";
const HOST_CONTRACT = "apps/web/src/editor/host/editor-host.ts";
const HOST_ROOTS = new Set([
	"apps/vite-example/src/host/vite-host-config.ts",
	"apps/web/src/editor/host/next-editor-host.ts",
]);

const fixtureFlag = process.argv.indexOf("--fixture");
const fixtureRoot =
	fixtureFlag >= 0 && process.argv[fixtureFlag + 1]
		? resolve(REPO_ROOT, process.argv[fixtureFlag + 1])
		: null;

/** These are test programs, not a directory-level exemption. */
const VERIFICATION_FILES = new Map([
	[
		"apps/vite-example/tests/parity/snapshot.ts",
		"parity snapshot reads the records that were actually persisted",
	],
	[
		"apps/vite-example/tests/probe/seed.ts",
		"legacy seed writes records that the current ProjectStore must not manufacture",
	],
	[
		"apps/vite-example/tests/probe/legacy-migration.pw.ts",
		"legacy probe inspects the migration's physical result",
	],
]);

/**
 * Non-library local UI preferences. Every entry is exact and carries its
 * classification; saved sounds and custom graph presets intentionally do not
 * appear here because they are durable ProjectStore library namespaces.
 */
const LOCAL_PREFERENCE_FILES = new Map([
	[
		"apps/web/src/changelog/components/changelog-notification.tsx",
		"changelog acknowledgement",
	],
	[
		"apps/web/src/feedback/components/feedback-popover.tsx",
		"local feedback-history convenience",
	],
	[
		"apps/web/src/components/editor/mobile-gate.tsx",
		"mobile-gate acknowledgement",
	],
	[
		"apps/web/src/components/ui/form.tsx",
		"generic form persistence supplied by UI callers",
	],
	[
		"apps/web/src/services/storage/use-local-storage.ts",
		"generic local preference hook, not durable editor content",
	],
	[
		"apps/web/src/components/editor/onboarding.tsx",
		"onboarding acknowledgement through useLocalStorage",
	],
	[
		"apps/web/src/services/storage/use-storage-persistence.ts",
		"browser persistence-prompt dismissal",
	],
]);

/**
 * Evidence-route state, kept separate from the preference list because it is
 * not a preference and must not be read as one.
 *
 * An entry here is reachable only from `/surface-evidence`, holds no user
 * content, and exists because the evidence it carries must survive a real page
 * reload *without* being read back out of the store under test — recording the
 * committed revision in that store would make the reopen assertion circular.
 * The classification is exact per file; every other localStorage use, on this
 * route or any other, is still refused.
 */
const EVIDENCE_LOCALSTORAGE_FILES = new Map([
	[
		"apps/web/src/editor/surface/evidence/agent-evidence-run.ts",
		"T4 agent commitment carried across the reopen reload, independent of the store being verified",
	],
]);

const STORAGE_APIS = [
	{
		id: "indexeddb",
		pattern: /\b(?:window\s*\.\s*)?indexedDB\b/,
		description: "IndexedDB call",
	},
	{
		id: "opfs",
		pattern: /\bnavigator\s*\.\s*storage\s*\.\s*getDirectory\b/,
		description: "OPFS root-handle call",
	},
	{
		id: "quota",
		pattern:
			/\bnavigator\s*\.\s*storage\s*\.\s*(?:estimate|persist|persisted)\b/,
		description: "StorageManager quota/persistence call",
	},
	{
		id: "idb-factory",
		pattern:
			/\b(?:IDBFactory|IDBDatabase|IDBObjectStore|IDBTransaction|IDBRequest)\b/,
		description: "IndexedDB mechanism type",
	},
	{
		id: "opfs-handle",
		pattern:
			/\b(?:FileSystemDirectoryHandle|FileSystemFileHandle|FileSystemHandle)\b/,
		description: "OPFS/file-system mechanism type",
	},
	{
		id: "storage-path",
		pattern:
			/\b(?:databaseName|databasePath|objectStoreName|opfsPath|storagePath)\??\s*:|["'`]video-editor-/,
		description: "physical database/store/path identity",
		appliesTo: (path) => isPublicPort(path),
	},
];

function fixtureFiles(root) {
	const paths = [];
	const visit = (directory) => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const absolute = join(directory, entry.name);
			if (entry.isDirectory()) visit(absolute);
			else paths.push(relative(root, absolute).replace(/\\/g, "/"));
		}
	};
	visit(root);
	return paths;
}

function realTreeFiles() {
	const requested = [...SOURCE_ROOTS, ...VERIFICATION_FILES.keys()];
	return execFileSync(
		"git",
		[
			"ls-files",
			"-z",
			"--cached",
			"--others",
			"--exclude-standard",
			...requested,
		],
		{ cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
	)
		.split("\0")
		.filter(Boolean);
}

function stripComments(source) {
	return source
		.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "))
		.replace(/^\s*\/\/.*$/gm, "");
}

function resolveSpecifier({ spec, fromFile }) {
	if (spec.startsWith("@/")) return `apps/web/src/${spec.slice(2)}`;
	if (!spec.startsWith(".")) return null;
	const parts = fromFile.split("/").slice(0, -1);
	for (const segment of spec.split("/")) {
		if (segment === "" || segment === ".") continue;
		if (segment === "..") parts.pop();
		else parts.push(segment);
	}
	return parts.join("/");
}

function isPublicPort(path) {
	return (
		path.startsWith(PUBLIC_PORT_AREA) &&
		!path.startsWith(`${PUBLIC_PORT_AREA}in-memory/`) &&
		!path.startsWith(`${PUBLIC_PORT_AREA}conformance/`) &&
		!path.includes("/__tests__/")
	);
}

function lineNumberAt(source, index) {
	return source.slice(0, index).split("\n").length;
}

function publicImportLeak({ line, path }) {
	const match = /from\s+["']([^"']+)["']/.exec(line);
	if (!match) return null;
	const spec = match[1];
	if (spec === "zustand" || spec.startsWith("zustand/")) {
		return "public-state-store-import";
	}
	const resolved = resolveSpecifier({ spec, fromFile: path });
	if (resolved === null || resolved.startsWith(PUBLIC_PORT_AREA)) return null;
	if (/^apps\/web\/src\/commands(?:\/|$)/.test(resolved)) {
		return "public-command-import";
	}
	if (/^apps\/web\/src\/(?:core|stores)(?:\/|$)/.test(resolved)) {
		return "public-state-store-import";
	}
	if (
		/^apps\/web\/src\/(?:project|timeline|scenes|effects|masks|media)(?:\/|$)/.test(
			resolved,
		)
	) {
		return "public-schema-import";
	}
	if (/^apps\/web\/src\/services\/storage(?:\/|$)/.test(resolved)) {
		return "public-storage-implementation-import";
	}
	return null;
}

const scanRoot = fixtureRoot ?? REPO_ROOT;
const files = [
	...new Set(fixtureRoot ? fixtureFiles(fixtureRoot) : realTreeFiles()),
]
	.filter((path) => /\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(path))
	.filter((path) => !path.includes("/__tests__/"))
	.filter(
		(path) =>
			fixtureRoot ||
			SOURCE_ROOTS.some(
				(root) => path === root || path.startsWith(`${root}/`),
			) ||
			VERIFICATION_FILES.has(path),
	)
	.filter((path) => existsSync(join(scanRoot, path)))
	.sort();

const violations = [];
const mechanismHits = [];
const singletonImports = [];
const adapterReferences = [];
const preferenceHits = new Map();

function addViolation({ rule, path, line, text, detail }) {
	violations.push({
		rule,
		path,
		line,
		text: text.trim().slice(0, 160),
		detail,
	});
}

for (const path of files) {
	const source = readFileSync(join(scanRoot, path), "utf8");
	const code = stripComments(source);
	const lines = code.split(/\r?\n/);
	const singletonDeclarations = [
		...code.matchAll(
			/(?:import|export)\s+(?:type\s+)?([\s\S]*?)\s+from\s+["'][^"']+["']/g,
		),
	].filter((match) => /\bstorageService\b/.test(match[1]));
	for (const match of singletonDeclarations) {
		const hit = {
			path,
			line: lineNumberAt(code, match.index),
			text: match[0].replace(/\s+/g, " ").trim(),
		};
		singletonImports.push(hit);
		addViolation({
			rule: "direct-singleton",
			...hit,
			detail: "storageService is a retired process-global dependency",
		});
	}
	for (const match of code.matchAll(/export\s+const\s+storageService\b/g)) {
		const hit = {
			path,
			line: lineNumberAt(code, match.index),
			text: match[0],
		};
		singletonImports.push(hit);
		addViolation({
			rule: "direct-singleton",
			...hit,
			detail: "storageService is a retired process-global dependency",
		});
	}

	lines.forEach((line, index) => {
		const lineNumber = index + 1;
		if (!line.trim()) return;

		if (/\bBrowserHostAdapter\b|browser-host-adapter/.test(line)) {
			const hit = { path, line: lineNumber, text: line.trim() };
			adapterReferences.push(hit);
			addViolation({
				rule: "retired-adapter",
				...hit,
				detail: "BrowserHostAdapter is retired and must not be resurrected",
			});
		}

		for (const api of STORAGE_APIS) {
			if (api.appliesTo && !api.appliesTo(path)) continue;
			if (!api.pattern.test(line)) continue;
			const allowedByStorage = path.startsWith(STORAGE_AREA);
			const allowedByFixture = VERIFICATION_FILES.has(path);
			const hit = {
				path,
				line: lineNumber,
				api: api.id,
				text: line.trim(),
				allowedBy: allowedByStorage
					? "storage-boundary"
					: allowedByFixture
						? "exact-verification-fixture"
						: null,
			};
			mechanismHits.push(hit);
			if (hit.allowedBy === null) {
				addViolation({
					rule: `mechanism:${api.id}`,
					...hit,
					detail: `${api.description} is outside ${STORAGE_AREA} and the three exact fixtures`,
				});
			}
		}

		if (/\b(?:window\s*\.\s*)?localStorage\b|\buseLocalStorage\b/.test(line)) {
			const hits = preferenceHits.get(path) ?? [];
			hits.push({ line: lineNumber, text: line.trim() });
			preferenceHits.set(path, hits);
			if (
				!LOCAL_PREFERENCE_FILES.has(path) &&
				!EVIDENCE_LOCALSTORAGE_FILES.has(path)
			) {
				const durableLibrary =
					/sounds-store|custom-presets-store/.test(path) ||
					/(?:saved sounds|custom graph presets)/i.test(line);
				addViolation({
					rule: durableLibrary
						? "durable-library-localstorage"
						: "unclassified-localstorage",
					path,
					line: lineNumber,
					text: line,
					detail: durableLibrary
						? "saved sounds and custom graph presets belong in the durable ProjectStore library"
						: "localStorage persistence is not an explicitly classified shell/UI preference",
				});
			}
		}

		if (isPublicPort(path)) {
			const importRule = publicImportLeak({ line, path });
			if (importRule) {
				addViolation({
					rule: importRule,
					path,
					line: lineNumber,
					text: line,
					detail:
						"the public storage contract must not expose editor schema, commands, state stores or storage implementations",
				});
			}
		}
	});

	if (!path.startsWith(STORAGE_AREA)) {
		if (
			/\b(?:interface|type|class)\s+(?:StoragePort|MediaStore|MediaPort|MediaStoragePort)\b/.test(
				code,
			)
		) {
			addViolation({
				rule: "second-storage-media-port",
				path,
				line: 1,
				text: "parallel storage/media port declaration",
				detail: "ProjectStore is the only persistence/media port",
			});
		}
		if (
			/createContext\s*<[^>]*(?:ProjectStore|StoragePort|MediaStore|MediaPort|MediaStoragePort|SessionPersistenceCoordinator|EditorHostPorts)/s.test(
				code,
			)
		) {
			addViolation({
				rule: "private-storage-context",
				path,
				line: 1,
				text: "private storage context",
				detail: "private storage contexts bypass the session-owned Host graph",
			});
		}
	}

	if (
		path === HOST_CONTRACT &&
		/\b(?:projectStore|mediaStore|storage|storagePort|mediaPort|mediaStorage|persistence|persistenceStore)\??\s*:/.test(
			code,
		)
	) {
		addViolation({
			rule: "hidden-host-storage",
			path,
			line: 1,
			text: "hidden Host storage/media property",
			detail:
				"EditorHost may expose persistence only through its required store role",
		});
	}

	if (HOST_ROOTS.has(path)) {
		const hasReferenceBundle = /\bcreateInMemoryPorts\s*\(/.test(code);
		const hasBrowserStore = /\bnew\s+BrowserProjectStore\s*\(/.test(code);
		const hasFallback =
			/\bInMemoryProjectStore\b/.test(code) ||
			/store\s*:\s*[^,\n]*(?:\?\?|\|\||\?[^:]*:)/.test(code);
		if ((hasReferenceBundle && !hasBrowserStore) || hasFallback) {
			addViolation({
				rule: "in-memory-production-fallback",
				path,
				line: 1,
				text: "in-memory production storage fallback",
				detail:
					"a production Host must explicitly provide BrowserProjectStore with no storage fallback",
			});
		}
	}
}

const unexpectedMechanisms = mechanismHits.filter(
	(hit) => hit.allowedBy === null,
);
const storageMechanisms = mechanismHits.filter(
	(hit) => hit.allowedBy === "storage-boundary",
);
const verificationMechanisms = mechanismHits.filter(
	(hit) => hit.allowedBy === "exact-verification-fixture",
);
const exercisedVerificationFiles = new Set(
	verificationMechanisms.map((hit) => hit.path),
);
const unexpectedPreferences = [...preferenceHits.keys()].filter(
	(path) =>
		!LOCAL_PREFERENCE_FILES.has(path) &&
		!EVIDENCE_LOCALSTORAGE_FILES.has(path),
);
// A classification that stopped being exercised is a stale exemption, so both
// lists are reported with whether anything actually matched them.
const staleEvidenceClassifications = [...EVIDENCE_LOCALSTORAGE_FILES.keys()]
	.filter((path) => !preferenceHits.has(path));

console.log(
	`check-storage-boundary: scanned ${files.length} source module(s) ` +
		(fixtureRoot
			? `(fixture ${relative(REPO_ROOT, fixtureRoot).replace(/\\/g, "/")})`
			: "(all production sources + 3 exact verification fixtures; tracked + uncommitted)"),
);
if (!fixtureRoot) {
	for (const [path, why] of VERIFICATION_FILES) {
		console.log(
			`  EXEMPT  ${path} — ${why}${exercisedVerificationFiles.has(path) ? " [observed]" : " [NOT OBSERVED]"}`,
		);
	}
	for (const [path, why] of LOCAL_PREFERENCE_FILES) {
		console.log(
			`  PREFERENCE  ${path} — ${why}${preferenceHits.has(path) ? " [observed]" : " [not used]"}`,
		);
	}
	for (const [path, why] of EVIDENCE_LOCALSTORAGE_FILES) {
		console.log(
			`  EVIDENCE  ${path} — ${why}${preferenceHits.has(path) ? " [observed]" : " [NOT OBSERVED]"}`,
		);
	}
}

const summaries = [
	{
		ok: singletonImports.length === 0,
		text: `direct storageService imports/exports: ${singletonImports.length}`,
	},
	{
		ok: adapterReferences.length === 0,
		text: `BrowserHostAdapter references: ${adapterReferences.length}`,
	},
	{
		ok: unexpectedMechanisms.length === 0,
		text:
			`unexpected browser-mechanism hits: ${unexpectedMechanisms.length}; ` +
			`allowed storage-boundary hits: ${storageMechanisms.length}; ` +
			`exact-fixture hits: ${verificationMechanisms.length}`,
	},
	{
		ok: unexpectedPreferences.length === 0,
		text: `unclassified persistence localStorage files: ${unexpectedPreferences.length}`,
	},
	{
		ok: staleEvidenceClassifications.length === 0,
		text:
			`evidence-route localStorage classifications, all exercised: ` +
			`${EVIDENCE_LOCALSTORAGE_FILES.size - staleEvidenceClassifications.length}` +
			`/${EVIDENCE_LOCALSTORAGE_FILES.size}`,
	},
	{
		ok: !violations.some((hit) =>
			/^(?:second-storage-media-port|private-storage-context|hidden-host-storage)$/.test(
				hit.rule,
			),
		),
		text: "one ProjectStore role, no private storage context or hidden Host property",
	},
	{
		ok: !violations.some((hit) => hit.rule === "in-memory-production-fallback"),
		text: "no production in-memory storage fallback",
	},
];

for (const summary of summaries) {
	console.log(`  ${summary.ok ? "PASS" : "FAIL"}  ${summary.text}`);
}

if (violations.length > 0) {
	console.error("\nStorage-boundary violations:");
	for (const violation of violations) {
		console.error(
			`  [${violation.rule}] ${violation.path}:${violation.line}: ${violation.detail} — ${violation.text}`,
		);
	}
	process.exit(1);
}

if (files.length === 0) {
	console.error("\nNo source modules found. An empty inventory is not a pass.");
	process.exit(1);
}

if (
	!fixtureRoot &&
	exercisedVerificationFiles.size !== VERIFICATION_FILES.size
) {
	console.error(
		"\nOne or more exact verification fixtures no longer exercises a browser mechanism; remove or repair the stale exemption.",
	);
	process.exit(1);
}

console.log(
	"\nclean — the final BrowserProjectStore/required-Host boundary holds.",
);

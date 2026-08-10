#!/usr/bin/env node
/**
 * Transaction contract boundary check (S03 T0, design D9).
 *
 * Modelled on S02's `check-port-boundary.mjs`. Scans every module under
 * `apps/web/src/editor/contracts/` and rejects:
 *
 * 1. **No editor-internal imports**: no import from `@/project`, `@/timeline`,
 *    `@/commands`, `@/core`, `@/stores`, `@/scenes`, `@/effects`, `@/masks`,
 *    `@/media`, `@/services/storage`, `@/wasm`, `zustand`, or any path ending
 *    in `-store`. What a Host persists or fetches with must not be observable in
 *    the contract.
 *
 * 2. **No storage-mechanism types**: no IndexedDB type names, no OPFS handle
 *    types, no `navigator.storage` calls, no physical storage fields in public
 *    signatures.
 *
 * **Negative control.** The `--negative-control` mode materialises a fixture
 * violating each rule and asserts each is caught — because a check that cannot
 * fail is not evidence.
 *
 *   node script/check-transaction-boundary.mjs
 *   node script/check-transaction-boundary.mjs --negative-control
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The contract graph. */
const CONTRACT_AREA = "apps/web/src/editor/contracts/";

/** Shared spellings — keep the rule and its targeted negative fixtures identical. */
const IDB_NAME = ["indexed", "DB"].join("");
const OPFS_CALL = ["navigator", "storage", "getDirectory"].join(".");
const QUOTA_CALL = ["navigator", "storage", "estimate"].join(".");
const IDB_TYPES =
	/\b(?:IDBFactory|IDBDatabase|IDBObjectStore|IDBTransaction|IDBRequest)\b/;
const OPFS_TYPES =
	/\b(?:FileSystemDirectoryHandle|FileSystemFileHandle|FileSystemHandle)\b/;
const PHYSICAL_STORAGE_FIELD =
	/\b(?:databaseName|databasePath|objectStoreName|opfsPath|storagePath)\??\s*:/;

const RULES = [
	{
		id: "no-editor-internal-import",
		description:
			"no contract module imports an OpenCut schema type, command class, editor store, wasm, or the storage service",
		test: (line, path) => {
			const match = /from\s+["']([^"']+)["']/.exec(line);
			if (!match) return false;
			const spec = match[1];
			if (spec === "zustand" || spec.startsWith("zustand/")) return true;
			if (spec === "opencut-wasm" || spec.startsWith("opencut-wasm/")) return true;

			const resolved = resolveSpecifier({ spec, fromFile: path });
			if (resolved === null) return false;

			// A contract module importing another contract module is not a leak,
			// by definition.
			if (isContractPath(resolved)) return false;

			// `(\/|$)` on every area, not `\/`: a directory-index specifier such
			// as `@/core` resolves without a trailing segment.
			return (
				/^apps\/web\/src\/(project|timeline|commands|core|stores|scenes|effects|masks|media)(\/|$)/.test(
					resolved,
				) ||
				/^apps\/web\/src\/services\/storage(\/|$)/.test(resolved) ||
				/-store$/.test(resolved) ||
				/^apps\/web\/src\/wasm(\/|$)/.test(resolved) ||
				/^opencut-wasm(\/|$)/.test(spec)
			);
		},
	},
	{
		id: "no-storage-mechanism-literal",
		description:
			"no public contract signature names a browser database/store/path type, identity or API",
		test: (line) =>
			new RegExp(`\\b${IDB_NAME}\\b`).test(line) ||
			line.includes(OPFS_CALL) ||
			line.includes(QUOTA_CALL) ||
			/\bnavigator\s*\.\s*storage\b/.test(line) ||
			IDB_TYPES.test(line) ||
			OPFS_TYPES.test(line) ||
			PHYSICAL_STORAGE_FIELD.test(line) ||
			/["'`]video-editor-/.test(line),
	},
];

/** A comment naming a rule is not a violation of it. */
function isComment(line) {
	return /^\s*(?:\/\/|\*|\/\*)/.test(line);
}

function isContractPath(repoRelative) {
	return (
		repoRelative === CONTRACT_AREA.slice(0, -1) ||
		repoRelative.startsWith(CONTRACT_AREA)
	);
}

/**
 * Turn an import specifier into a repo-relative module path. Returns `null` for
 * a bare package specifier that this rule does not judge.
 */
function resolveSpecifier({ spec, fromFile }) {
	if (spec.startsWith("@/")) return `apps/web/src/${spec.slice(2)}`;
	if (!spec.startsWith(".")) return null;
	const parts = fromFile.split("/").slice(0, -1);
	for (const segment of spec.split("/")) {
		if (segment === "." || segment === "") continue;
		if (segment === "..") parts.pop();
		else parts.push(segment);
	}
	return parts.join("/");
}

function scan({ path, text }) {
	const violations = [];
	const lines = text.split(/\r?\n/);
	for (const rule of RULES) {
		lines.forEach((line, index) => {
			if (isComment(line)) return;
			if (!rule.test(line, path)) return;
			violations.push({
				rule: rule.id,
				path,
				line: index + 1,
				text: line.trim().slice(0, 140),
			});
		});
	}
	return violations;
}

function contractFiles() {
	return execFileSync(
		"git",
		["ls-files", "-z", "--cached", "--others", "--exclude-standard", "apps"],
		{ cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
	)
		.split("\0")
		.filter(Boolean)
		.filter((path) => path.startsWith(CONTRACT_AREA))
		.filter((path) => /\.(ts|tsx)$/.test(path));
}

/**
 * The negative control. Each fixture violates exactly one rule, so a caught
 * violation attributes to the rule that caught it. Converse fixtures prove a
 * rule does not fire indiscriminately.
 */
const NEGATIVE_CONTROL_FIXTURES = [
	{
		rule: "no-editor-internal-import",
		path: "apps/web/src/editor/contracts/violation.ts",
		text: 'import type { TProject } from "@/project/types";\nexport type X = TProject;\n',
	},
	{
		rule: "no-editor-internal-import",
		path: "apps/web/src/editor/contracts/violation.ts",
		text: 'import type { TProject } from "../../project/types";\nexport type X = TProject;\n',
		note: "a relative specifier is caught too",
	},
	{
		rule: "no-editor-internal-import",
		path: "apps/web/src/editor/contracts/violation.ts",
		text: 'import { EditorCore } from "@/core";\nexport type X = EditorCore;\n',
		note: "a directory-index specifier is caught",
	},
	{
		rule: "no-editor-internal-import",
		path: "apps/web/src/editor/contracts/violation.ts",
		text: 'import { MediaTime } from "@/wasm/media-time";\nexport type X = MediaTime;\n',
		note: "wasm imports are banned — the contract defines its own MediaTime",
	},
	{
		rule: "no-editor-internal-import",
		path: "apps/web/src/editor/contracts/violation.ts",
		text: 'import { create_compositor } from "opencut-wasm";\nexport const c = create_compositor;\n',
		note: "bare-package wasm import is caught",
	},
	{
		rule: "no-editor-internal-import",
		path: "apps/web/src/editor/contracts/violation.ts",
		text: 'import type { ProjectState } from "@/stores/project-store";\nexport type X = ProjectState;\n',
		note: "an editor state-store import is caught",
	},
	{
		rule: "no-editor-internal-import",
		path: "apps/web/src/editor/contracts/violation.ts",
		text: 'import { storageService } from "@/services/storage/service";\nexport const X = storageService;\n',
		note: "the storage service singleton is caught",
	},
	{
		rule: "no-editor-internal-import",
		path: "apps/web/src/editor/contracts/violation.ts",
		text: 'import { useStore } from "zustand";\nexport const X = useStore;\n',
		note: "zustand is caught",
	},
	{
		rule: "no-editor-internal-import",
		expect: "not-caught",
		path: "apps/web/src/editor/contracts/violation.ts",
		text: 'import type { MediaTime } from "./domain";\nexport type X = MediaTime;\n',
		note: "a contract module importing another contract module is not a leak",
	},
	{
		rule: "no-storage-mechanism-literal",
		path: "apps/web/src/editor/contracts/violation.ts",
		text: `export const db = ${IDB_NAME}.open("video-editor-projects");\n`,
	},
	{
		rule: "no-storage-mechanism-literal",
		path: "apps/web/src/editor/contracts/violation.ts",
		text: `export const root = await ${OPFS_CALL}();\n`,
	},
	{
		rule: "no-storage-mechanism-literal",
		path: "apps/web/src/editor/contracts/interfaces.ts",
		text: "export interface TransactionRead { open(): Promise<IDBDatabase>; }\n",
		note: "an IndexedDB type in a public signature is a mechanism leak",
	},
	{
		rule: "no-storage-mechanism-literal",
		path: "apps/web/src/editor/contracts/interfaces.ts",
		text: "export interface TransactionRead { root(): Promise<FileSystemDirectoryHandle>; }\n",
		note: "an OPFS handle type in a public signature is a mechanism leak",
	},
	{
		rule: "no-storage-mechanism-literal",
		path: "apps/web/src/editor/contracts/interfaces.ts",
		text: "export interface TransactionRead { databaseName: string; opfsPath: string; }\n",
		note: "physical storage fields are not mechanism-neutral",
	},
	{
		rule: "no-storage-mechanism-literal",
		expect: "not-caught",
		path: "apps/web/src/editor/contracts/violation.ts",
		text: "export interface TransactionRead { id: string; name: string; }\n",
		note: "plain fields do not trigger the storage-mechanism rule",
	},
];

function runNegativeControl() {
	console.log("check-transaction-boundary: negative control");
	let allAsExpected = true;
	for (const fixture of NEGATIVE_CONTROL_FIXTURES) {
		const expectCaught = (fixture.expect ?? "caught") === "caught";
		const violations = scan({ path: fixture.path, text: fixture.text });
		const caught = violations.some((v) => v.rule === fixture.rule);
		const ok = caught === expectCaught;
		if (!ok) allAsExpected = false;
		const verdict = caught ? "caught" : "not caught";
		console.log(
			`  ${ok ? "PASS" : "FAIL"}  ${fixture.rule} — ${verdict}` +
				`${expectCaught ? "" : " (expected not caught)"}` +
				`${fixture.note ? ` [${fixture.note}]` : ""}: ${fixture.text.trim().split("\n")[0]}`,
		);
	}

	console.log(
		`\n  ${allAsExpected ? "PASS" : "FAIL"}  every rule is proven able to fail, and proven not to fire indiscriminately`,
	);
	if (!allAsExpected) process.exit(1);
	console.log("\nnegative control clean — a passing result is not vacuous.");
}

function runCheck() {
	const files = contractFiles();
	const violations = [];
	for (const path of files) {
		let text;
		try {
			text = readFileSync(join(REPO_ROOT, path), "utf8");
		} catch {
			continue;
		}
		violations.push(...scan({ path, text }));
	}

	console.log(
		`check-transaction-boundary: scanned ${files.length} contract module(s) (tracked + uncommitted)`,
	);
	for (const rule of RULES) {
		const hits = violations.filter((v) => v.rule === rule.id);
		console.log(
			`  ${hits.length === 0 ? "PASS" : "FAIL"}  ${rule.id}: ${rule.description}`,
		);
	}

	if (violations.length > 0) {
		console.error("\nTransaction-boundary violations:");
		for (const v of violations) {
			console.error(`  [${v.rule}] ${v.path}:${v.line}: ${v.text}`);
		}
		process.exit(1);
	}

	if (files.length === 0) {
		console.error(
			"\nNo contract modules found. A check that scanned nothing has not passed.",
		);
		process.exit(1);
	}

	console.log(
		"\nclean — run with --negative-control to see each rule proven able to fail.",
	);
}

if (process.argv.includes("--negative-control")) runNegativeControl();
else runCheck();

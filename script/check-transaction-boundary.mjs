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
 * It also scans the **published vector corpus** (S03 T4) — the `.json` data
 * under `contracts/vectors/corpus/` — with rules the import-shaped ones cannot
 * express, because a donor name arriving as a JSON string value is invisible to
 * them:
 *
 * 3. no donor schema field name, 4. no command-class name, 5. no editor state
 * store, 6. no browser database/object-store/file-handle identity, 7. no
 * provider-namespaced key, 8. no physical storage path.
 *
 * **Negative control.** The `--negative-control` mode materialises a fixture
 * violating each rule and asserts each is caught — and, for the data rules,
 * that each fixture trips *only* its own rule and that the contract's public
 * vocabulary (`track`, `clip`, `asset`, `marker`, `project`, a `video`-kind
 * asset, the closed code sets) trips none. A check that cannot fail is not
 * evidence; a check that fires on the vocabulary it exists to protect is
 * unusable.
 *
 * **Empty-scan control.** `--empty-scan-control` proves that zero contract
 * modules or zero corpus files is a refusal rather than a clean scan.
 *
 *   node script/check-transaction-boundary.mjs
 *   node script/check-transaction-boundary.mjs --negative-control
 *   node script/check-transaction-boundary.mjs --empty-scan-control
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

/**
 * Rules over **published vector data** (S03 T4, design D5).
 *
 * The import-shaped rules above cannot see a donor name that arrives as a JSON
 * string, so the corpus needs its own rules. They are written to discriminate
 * provider identity from the contract's public vocabulary: `track`, `clip`,
 * `asset`, `marker`, `project` and a `video`-kind asset are the corpus's own
 * words and must never fire, which the converse control below enforces.
 */
const DONOR_SCHEMA_FIELDS =
	/\b(?:timelineElement|TimelineElement|TimelineTrack|mediaId|bookmarks|currentSceneId|sceneId|canvasSize|sourceType|trimReference|elements|retime)\b/;
const COMMAND_CLASS_NAME = /\b[A-Z][A-Za-z0-9]*Command\b|\bcommitUi\b|\bProjectMutationArbiter\b/;
const STATE_STORE_NAME =
	/\buse[A-Z][A-Za-z0-9]*Store\b|\bzustand\b|\b[a-z][a-z0-9]*-store\b|\bEditorCore\b/;
const STORAGE_IDENTITY = new RegExp(
	`\\b${IDB_NAME}\\b|\\bIDB[A-Z][A-Za-z]*\\b|\\bobjectStore[A-Za-z]*\\b|\\bFileSystem(?:Directory|File)?Handle\\b|video-editor-`,
	"i",
);
const PROVIDER_NAMESPACED_KEY = /opencut/i;
const PHYSICAL_STORAGE_PATH =
	/[A-Za-z]:\\\\|\/(?:var|usr|home|tmp|opt|Users)\/|\.(?:sqlite|idb|leveldb)\b|opfs:/;

const DATA_RULES = [
	{
		id: "no-donor-schema-field",
		description:
			"no published vector key or value names a donor schema field",
		test: (line) => DONOR_SCHEMA_FIELDS.test(line),
	},
	{
		id: "no-command-class-name",
		description: "no published vector names a command class or its commit path",
		test: (line) => COMMAND_CLASS_NAME.test(line),
	},
	{
		id: "no-editor-state-store",
		description: "no published vector names an editor state store",
		test: (line) => STATE_STORE_NAME.test(line),
	},
	{
		id: "no-storage-identity",
		description:
			"no published vector names a browser database, object store or file-system handle",
		test: (line) => STORAGE_IDENTITY.test(line),
	},
	{
		id: "no-provider-namespaced-key",
		description: "no published vector carries a provider-namespaced key",
		test: (line) => PROVIDER_NAMESPACED_KEY.test(line),
	},
	{
		id: "no-physical-storage-path",
		description: "no published vector carries a physical storage path",
		test: (line) => PHYSICAL_STORAGE_PATH.test(line),
	},
];

/**
 * The refusal both scans share: a check that matched nothing has not passed.
 * Returned rather than thrown so `--empty-scan-control` can prove it.
 */
function emptyScanRefusal({ modules, corpus }) {
	if (modules === 0) {
		return "No contract module found. A check that scanned nothing has not passed.";
	}
	if (corpus === 0) {
		return "No published vector file found. The data rules scanned nothing, and a scan of nothing has not passed.";
	}
	return null;
}

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

function scan({ path, text, rules = RULES }) {
	const violations = [];
	const lines = text.split(/\r?\n/);
	for (const rule of rules) {
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

/** Every tracked-or-uncommitted file under the contract area. */
function contractArea() {
	return execFileSync(
		"git",
		["ls-files", "-z", "--cached", "--others", "--exclude-standard", "apps"],
		{ cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
	)
		.split("\0")
		.filter(Boolean)
		.filter((path) => path.startsWith(CONTRACT_AREA));
}

function contractFiles() {
	return contractArea().filter((path) => /\.(ts|tsx)$/.test(path));
}

/** The published corpus: data, judged by the data rules. */
function corpusFiles() {
	return contractArea().filter((path) =>
		/^apps\/web\/src\/editor\/contracts\/vectors\/corpus\/.+\.json$/.test(path),
	);
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

/**
 * One fixture per data rule, each violating exactly one, plus converse fixtures
 * built from the corpus's own public vocabulary. A rule that fires on `track`,
 * `clip`, `asset`, `marker`, `project` or a `video`-kind asset is unusable, so
 * the converse fixtures are part of the check rather than part of a review.
 */
const CORPUS_CONTROL_FIXTURES = [
	{
		rule: "no-donor-schema-field",
		path: "apps/web/src/editor/contracts/vectors/corpus/violation.json",
		text: '{ "clip": { "timelineElement": "el-1" } }\n',
	},
	{
		rule: "no-donor-schema-field",
		path: "apps/web/src/editor/contracts/vectors/corpus/violation.json",
		text: '{ "clip": { "mediaId": "asset-1" } }\n',
		note: "a donor relation field is caught in a value position too",
	},
	{
		rule: "no-command-class-name",
		path: "apps/web/src/editor/contracts/vectors/corpus/violation.json",
		text: '{ "title": "applied by MoveElementCommand" }\n',
	},
	{
		rule: "no-editor-state-store",
		path: "apps/web/src/editor/contracts/vectors/corpus/violation.json",
		text: '{ "title": "read through useTimelineStore" }\n',
	},
	{
		rule: "no-storage-identity",
		path: "apps/web/src/editor/contracts/vectors/corpus/violation.json",
		text: '{ "title": "objectStoreName video-editor-projects" }\n',
	},
	{
		rule: "no-provider-namespaced-key",
		path: "apps/web/src/editor/contracts/vectors/corpus/violation.json",
		text: '{ "__opencutTransaction": { "revision": 1 } }\n',
	},
	{
		rule: "no-physical-storage-path",
		path: "apps/web/src/editor/contracts/vectors/corpus/violation.json",
		text: '{ "title": "/var/lib/projects.sqlite" }\n',
	},
	{
		rule: "*",
		expect: "not-caught",
		path: "apps/web/src/editor/contracts/vectors/corpus/converse.json",
		text:
			'{ "vectors": [ { "id": "document/public-vocabulary", "title": "track, clip, asset, marker and project are the public vocabulary",' +
			' "batch": { "operations": [ { "kind": "create-track", "track": { "id": "track-video", "kind": "video", "name": "Video lane", "hidden": false } },' +
			' { "kind": "create-asset", "asset": { "id": "asset-reel", "kind": "video", "name": "Reel", "duration": 1200000 } },' +
			' { "kind": "create-clip", "clip": { "id": "clip-caption", "trackId": "track-text", "assetId": "asset-reel", "startTime": 0, "duration": 40000, "trimStart": 0, "trimEnd": 0 } },' +
			' { "kind": "create-marker", "marker": { "id": "marker-open", "time": 0, "note": "open" } },' +
			' { "kind": "update-project", "projectId": "vector-project", "patch": { "name": "Renamed", "canvasWidth": 1280, "canvasHeight": 720 } } ] } } ] }\n',
		note: "the contract's public vocabulary must survive every data rule",
	},
	{
		rule: "*",
		expect: "not-caught",
		path: "apps/web/src/editor/contracts/vectors/corpus/converse.json",
		text: '{ "expect": { "outcome": "rejected", "errorCode": "conflict", "issueCodes": ["collision", "lane-incompatible"] } }\n',
		note: "closed error and issue codes are public vocabulary too",
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

	for (const fixture of CORPUS_CONTROL_FIXTURES) {
		const expectCaught = (fixture.expect ?? "caught") === "caught";
		const violations = scan({
			path: fixture.path,
			text: fixture.text,
			rules: DATA_RULES,
		});
		const caught =
			fixture.rule === "*"
				? violations.length > 0
				: violations.some((v) => v.rule === fixture.rule);
		// A targeted fixture must trip its own rule and no other, so a caught
		// violation attributes to the rule that caught it.
		const onlyItsOwn =
			fixture.rule === "*" ||
			violations.every((v) => v.rule === fixture.rule);
		const ok = caught === expectCaught && onlyItsOwn;
		if (!ok) allAsExpected = false;
		console.log(
			`  ${ok ? "PASS" : "FAIL"}  ${fixture.rule} — ${caught ? "caught" : "not caught"}` +
				`${expectCaught ? "" : " (expected not caught)"}` +
				`${onlyItsOwn ? "" : ` [also tripped ${[...new Set(violations.map((v) => v.rule))].join(", ")}]`}` +
				`${fixture.note ? ` [${fixture.note}]` : ""}`,
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
	const corpus = corpusFiles();
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
	for (const path of corpus) {
		let text;
		try {
			text = readFileSync(join(REPO_ROOT, path), "utf8");
		} catch {
			continue;
		}
		violations.push(...scan({ path, text, rules: DATA_RULES }));
	}

	console.log(
		`check-transaction-boundary: scanned ${files.length} contract module(s) and ` +
			`${corpus.length} published vector file(s) (tracked + uncommitted)`,
	);
	for (const rule of [...RULES, ...DATA_RULES]) {
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

	const refusal = emptyScanRefusal({
		modules: files.length,
		corpus: corpus.length,
	});
	if (refusal) {
		console.error(`\n${refusal}`);
		process.exit(1);
	}

	console.log(
		"\nclean — run with --negative-control to see each rule proven able to fail.",
	);
}

/**
 * Prove the zero-match refusals, and prove they do not fire on a real scan.
 * Without this, "0 files scanned, clean" would read exactly like a pass.
 */
function runEmptyScanControl() {
	console.log("check-transaction-boundary: empty-scan control");
	const cases = [
		{ name: "zero contract modules", modules: 0, corpus: 3, refuse: true },
		{ name: "zero published vector files", modules: 50, corpus: 0, refuse: true },
		{ name: "a real scan", modules: 50, corpus: 3, refuse: false },
	];
	let allAsExpected = true;
	for (const testCase of cases) {
		const refusal = emptyScanRefusal(testCase);
		const ok = (refusal !== null) === testCase.refuse;
		if (!ok) allAsExpected = false;
		console.log(
			`  ${ok ? "PASS" : "FAIL"}  ${testCase.name} — ${refusal ?? "no refusal"}`,
		);
	}
	const live = { modules: contractFiles().length, corpus: corpusFiles().length };
	const liveOk = live.modules > 0 && live.corpus > 0;
	if (!liveOk) allAsExpected = false;
	console.log(
		`  ${liveOk ? "PASS" : "FAIL"}  the live scan matches ${live.modules} module(s) and ${live.corpus} vector file(s)`,
	);
	if (!allAsExpected) process.exit(1);
	console.log("\nempty-scan control clean.");
}

// An unrecognised flag is refused rather than treated as "run the normal
// scan": a mistyped control that prints a clean scan is worse than no control.
const KNOWN_FLAGS = new Set(["--negative-control", "--empty-scan-control"]);
const unknownFlags = process.argv
	.slice(2)
	.filter((flag) => !KNOWN_FLAGS.has(flag));
if (unknownFlags.length > 0) {
	console.error(
		`check-transaction-boundary: unknown flag(s) ${unknownFlags.join(", ")}. ` +
			`Known: ${[...KNOWN_FLAGS].join(", ")}.`,
	);
	process.exit(2);
}

if (process.argv.includes("--negative-control")) runNegativeControl();
else if (process.argv.includes("--empty-scan-control")) runEmptyScanControl();
else runCheck();

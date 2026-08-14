#!/usr/bin/env node
/**
 * Host port-contract boundary check (S02 child C1, design D6).
 *
 * Two directions, both mechanical rather than by review:
 *
 * 1. **Nothing editor-internal leaks out through a port.** No module in the
 *    contract graph imports an OpenCut schema type, a command class, an editor
 *    state store or the storage service, and none names a storage mechanism —
 *    a database name, an object-store prefix, or an origin-private filesystem
 *    call. What a Host persists or fetches with must not be observable in the
 *    contract.
 *
 * 2. **Nothing is acquired outside the registry.** No contract module constructs
 *    a worker or an audio context, or creates an object URL, except the one
 *    module whose job is to mediate acquisition. This is the converse the Worker
 *    decision (D2) and the disposal decision (D5) both depend on: a
 *    register-after-the-fact registry inherits Elftia's
 *    `PluginDisposerRegistry` blindness by construction, and only a check can
 *    turn a forgotten acquisition into a failure instead of a leak.
 *
 * **Scope.** Direction 2 is asserted over the ports and session modules **only**,
 * not repo-wide. The editor still holds one `new Worker(...)` site
 * (`services/transcription/service.ts:114`), ten `URL.createObjectURL` sites and
 * two audio-context constructions, and this change is forbidden to touch them —
 * C4 and C6 rewire them. Turning the repo-wide form on today would fail on code
 * nobody is allowed to fix, which is a check that has to be disabled to commit,
 * which is not a check. The widening is C4/C6's to make.
 *
 *   node script/check-port-boundary.mjs
 *   node script/check-port-boundary.mjs --negative-control
 *
 * The negative control materialises a fixture that violates every rule and
 * asserts each one is caught, because a check that cannot fail is not evidence —
 * `check-storage-boundary`, `check-next-imports` and
 * `check-distributable-boundary` all carry one.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The contract graph: the port surface, the session runtime, and the seam. */
const CONTRACT_AREAS = [
	"packages/editor-ports/src/",
	"packages/editor-classic/src/editor/session/",
];
const CONTRACT_FILES = new Set(["packages/editor-ports/src/host/index.ts"]);

/**
 * The single module allowed to reach the platform's timer functions, because it
 * is the thing that makes every other call site unnecessary. Named as one file
 * rather than as a directory, so a second file cannot quietly inherit it.
 */
const REGISTRY_MODULE =
	"packages/editor-classic/src/editor/session/session-resources.ts";

/**
 * Areas that are not editor runtime code, each with the reason it is not subject
 * to direction 2. Listed individually so an exemption cannot be acquired by
 * being nearby.
 */
const NON_RUNTIME_AREAS = [
	{
		prefix: "packages/editor-ports/src/in-memory/",
		why: "a Host implementation — constructing runtime resources is what a Host is for, and forbidding it here would forbid the one thing this code exists to demonstrate (D2)",
	},
	{
		prefix: "packages/editor-ports/src/conformance/",
		why: "an adapter author's harness — it exercises ports directly, with no session in existence, so no registry can be reachable from it by construction",
	},
	{
		prefix: "packages/editor-ports/src/__tests__/",
		why: "tests",
	},
	{
		prefix: "packages/editor-classic/src/editor/session/__tests__/",
		why: "tests",
	},
];

function isNonRuntime(path) {
	return NON_RUNTIME_AREAS.some((area) => path.startsWith(area.prefix));
}

/**
 * A TypeScript member *declaration*, not a call.
 *
 * `SessionResources` declares `setTimeout(args: { ... }): TimerHandle` — the
 * interface that exists precisely so nothing else calls the global one. A scan
 * that flagged the declaration would make the rule unsatisfiable by the module
 * that implements it. The discriminator is exact rather than fuzzy: a typed
 * parameter (`name:` or `name?:`) at the head of the argument list is something
 * a call site never has.
 */
function isMemberDeclaration(line) {
	return /^\s*(?:setTimeout|setInterval|requestAnimationFrame)\s*\(\s*\w+\s*\??\s*:/.test(
		line,
	);
}

/** Shared spellings keep the rule and its targeted negative fixtures identical. */
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
			"no port module imports an OpenCut schema type, command class, editor store or the storage service",
		test: (line, path) => {
			const match = /from\s+["']([^"']+)["']/.exec(line);
			if (!match) return false;
			const spec = match[1];
			if (spec === "zustand" || spec.startsWith("zustand/")) return true;

			const resolved = resolveSpecifier({ spec, fromFile: path });
			if (resolved === null) return false;

			// A contract module importing another contract module is not a leak, by
			// definition. This matters once relative specifiers are resolved: the
			// contract's own `../project-store` would otherwise look exactly like a
			// Zustand store to the `-store` rule below.
			if (isContractPath(resolved)) return false;

			// `(\/|$)` on every area, not `\/`: a directory-index specifier such as
			// `@/core` or `../../commands` resolves without a trailing segment and
			// would otherwise slip past a slash-anchored pattern.
			return (
				/^(?:apps\/web\/src|packages\/editor-classic\/src)\/(project|timeline|commands|core|stores|scenes|effects|masks|media)(\/|$)/.test(
					resolved,
				) ||
				/^(?:apps\/web\/src|packages\/editor-classic\/src)\/services\/storage(\/|$)/.test(
					resolved,
				) ||
				/-store$/.test(resolved)
			);
		},
	},
	{
		id: "no-direct-wasm-import",
		description:
			"the contract graph does not reach the wasm module; GPU handles arrive through the injected runtime query",
		appliesTo: (path) => !isNonRuntime(path),
		test: (line) => {
			const match = /from\s+["']([^"']+)["']/.exec(line);
			if (!match) return false;
			// **A fence, not an acquisition check.** It bans an *import*, which is not
			// the same thing as banning an allocation: a wasm allocation has no
			// syntactic form to scan for, because it happens inside the module. What
			// closes the GPU blind spot is `dispose()` reconciling the registry
			// against `RuntimeGpuResourceQuery.liveHandles()`; this rule only keeps
			// the contract graph from acquiring a way to bypass that.
			//
			// It is also scoped to ports/session. The three real allocators —
			// `services/renderer/gpu-renderer.ts`,
			// `services/renderer/compositor/wasm-compositor.ts` and
			// `wasm/media-time.ts` — sit outside it, and stay outside until C4/C6
			// rewire them. Do not read a pass here as a claim about them.
			return /^opencut-wasm(\/|$)/.test(match[1]);
		},
	},
	{
		id: "no-storage-mechanism-literal",
		description:
			"no public port signature names a browser database/store/path type, identity or API",
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
	{
		id: "no-direct-resource-acquisition",
		description:
			"no contract module constructs a worker or audio context, or creates an object URL, outside the registry",
		appliesTo: (path) => path !== REGISTRY_MODULE && !isNonRuntime(path),
		test: (line) =>
			/\bnew\s+Worker\s*\(/.test(line) ||
			/\bnew\s+(?:webkit)?AudioContext\s*\(/.test(line) ||
			/\bURL\.createObjectURL\s*\(/.test(line),
	},
	{
		id: "no-direct-timer-acquisition",
		description:
			"no contract module calls the platform's timer functions outside the registry",
		appliesTo: (path) => path !== REGISTRY_MODULE && !isNonRuntime(path),
		test: (line) =>
			!isMemberDeclaration(line) &&
			/(?:^|[^.\w])(?:window\.)?(?:setTimeout|setInterval|requestAnimationFrame)\s*\(/.test(
				line,
			) &&
			!/\.(?:setTimeout|setInterval|requestAnimationFrame)\s*\(/.test(line),
	},
];

/** A comment naming a rule is not a violation of it. */
function isComment(line) {
	return /^\s*(?:\/\/|\*|\/\*)/.test(line);
}

function isContractPath(repoRelative) {
	return (
		CONTRACT_FILES.has(repoRelative) ||
		CONTRACT_AREAS.some(
			(area) =>
				repoRelative === area.slice(0, -1) || repoRelative.startsWith(area),
		)
	);
}

/**
 * Turn an import specifier into a repo-relative module path.
 *
 * Relative specifiers are resolved against the **importing file's directory**
 * rather than string-rewritten. Rewriting `../../../project/types` to `@/…` by
 * pattern was the naive version, and it mis-attributed the contract's own
 * `../project-store` to the editor's store area. Returns `null` for a bare
 * package specifier, which this rule does not judge.
 *
 * No `@/`-alias branch: Group 6 (s05-package-extraction) rewrote every
 * contract-graph specifier from the alias form to intra-package relative
 * imports, so the relative walk below is the only form this graph uses now.
 */
function resolveSpecifier({ spec, fromFile }) {
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
		if (rule.appliesTo && !rule.appliesTo(path)) continue;
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
	// `--others --exclude-standard` alongside `--cached`, for the same reason
	// `check-storage-boundary` does it: a check reviewed before the commit must
	// see the files the change adds, or it reports a pass on an empty set.
	return execFileSync(
		"git",
		[
			"ls-files",
			"-z",
			"--cached",
			"--others",
			"--exclude-standard",
			"apps",
			"packages",
		],
		{ cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
	)
		.split("\0")
		.filter(Boolean)
		.filter(
			(path) =>
				CONTRACT_FILES.has(path) ||
				CONTRACT_AREAS.some((area) => path.startsWith(area)),
		)
		.filter((path) => /\.(ts|tsx)$/.test(path));
}

/**
 * The negative control. Each fixture violates exactly one rule, so a caught
 * violation attributes to the rule that caught it rather than to "something
 * fired".
 */
const NEGATIVE_CONTROL_FIXTURES = [
	{
		rule: "no-editor-internal-import",
		path: "packages/editor-ports/src/violation.ts",
		text: 'import type { TProject } from "../../editor-classic/src/project/types";\nexport type X = TProject;\n',
	},
	{
		rule: "no-editor-internal-import",
		path: "packages/editor-ports/src/violation.ts",
		text: 'import type { TProject } from "../../../packages/editor-classic/src/project/types";\nexport type X = TProject;\n',
		note: "a longer relative specifier resolving to the same area is caught too, not only the shortest form",
	},
	{
		rule: "no-editor-internal-import",
		expect: "not-caught",
		path: "packages/editor-ports/src/in-memory/violation.ts",
		text: 'import type { ProjectStore } from "../project-store";\nexport type X = ProjectStore;\n',
		note: "a contract module importing another contract module is not a leak",
	},
	{
		rule: "no-direct-wasm-import",
		path: "packages/editor-classic/src/editor/session/violation.ts",
		text: 'import { create_compositor } from "opencut-wasm";\nexport const c = create_compositor;\n',
	},
	{
		rule: "no-editor-internal-import",
		path: "packages/editor-ports/src/violation.ts",
		text: 'import { EditorCore } from "../../editor-classic/src/core";\nexport type X = EditorCore;\n',
		note: "a directory-index specifier resolves without a trailing segment and is caught too",
	},
	{
		rule: "no-editor-internal-import",
		path: "packages/editor-ports/src/project-store.ts",
		text: 'import type { AddMediaAssetCommand } from "../../editor-classic/src/commands/media/add-media-asset";\nexport type X = AddMediaAssetCommand;\n',
		note: "a command class cannot become part of the public storage contract",
	},
	{
		rule: "no-editor-internal-import",
		path: "packages/editor-ports/src/project-store.ts",
		text: 'import type { ProjectState } from "../../editor-classic/src/stores/project-store";\nexport type X = ProjectState;\n',
		note: "an editor state-store import cannot become part of the public storage contract",
	},
	{
		rule: "no-editor-internal-import",
		path: "packages/editor-ports/src/project-store.ts",
		text: 'import { storageService } from "../../editor-classic/src/services/storage/service";\nexport const X = storageService;\n',
		note: "the public port cannot import its browser implementation or singleton",
	},
	{
		rule: "no-storage-mechanism-literal",
		path: "packages/editor-ports/src/violation.ts",
		text: `export const db = ${IDB_NAME}.open("video-editor-projects");\n`,
	},
	{
		rule: "no-storage-mechanism-literal",
		path: "packages/editor-ports/src/violation.ts",
		text: `export const root = await ${OPFS_CALL}();\n`,
	},
	{
		rule: "no-storage-mechanism-literal",
		path: "packages/editor-ports/src/project-store.ts",
		text: "export interface ProjectStore { open(): Promise<IDBDatabase>; }\n",
		note: "an IndexedDB type in a public signature is a mechanism leak",
	},
	{
		rule: "no-storage-mechanism-literal",
		path: "packages/editor-ports/src/project-store.ts",
		text: "export interface ProjectStore { root(): Promise<FileSystemDirectoryHandle>; }\n",
		note: "an OPFS handle type in a public signature is a mechanism leak",
	},
	{
		rule: "no-storage-mechanism-literal",
		path: "packages/editor-ports/src/project-store.ts",
		text: "export interface ProjectStore { databaseName: string; objectStoreName: string; opfsPath: string; }\n",
		note: "physical database/store/path fields are not mechanism-neutral",
	},
	{
		rule: "no-direct-resource-acquisition",
		path: "packages/editor-ports/src/violation.ts",
		text: 'export const w = new Worker(new URL("./worker.ts", import.meta.url));\n',
	},
	{
		rule: "no-direct-resource-acquisition",
		path: "packages/editor-classic/src/editor/session/violation.ts",
		text: "export const url = URL.createObjectURL(blob);\n",
	},
	{
		rule: "no-direct-resource-acquisition",
		path: "packages/editor-classic/src/editor/session/violation.ts",
		text: "export const ctx = new AudioContext();\n",
	},
	{
		rule: "no-direct-timer-acquisition",
		path: "packages/editor-ports/src/violation.ts",
		text: "export const t = setTimeout(() => {}, 10);\n",
	},
	// The discriminators must not be blanket holes. These assert the *converse*:
	// a rule that could be silenced by writing the violation slightly differently
	// would pass the fixtures above and still be worthless.
	{
		rule: "no-direct-timer-acquisition",
		expect: "not-caught",
		path: "packages/editor-classic/src/editor/session/resources.ts",
		text: "	setTimeout(args: { handler: () => void; ms: number }): TimerHandle;\n",
		note: "a member declaration is not a call",
	},
	{
		rule: "no-direct-timer-acquisition",
		expect: "caught",
		path: "packages/editor-ports/src/violation.ts",
		text: "	setTimeout(handler, 10);\n",
		note: "a call at the head of a line is still a call",
	},
	{
		rule: "no-direct-resource-acquisition",
		expect: "not-caught",
		path: "packages/editor-ports/src/in-memory/violation.ts",
		text: "export const w = new Worker(new URL('./worker.ts', import.meta.url));\n",
		note: "a Host implementation may construct — that is what a Host is for",
	},
];

const CONTRACT_PATH_CONTROL_FIXTURES = [
	{
		path: "packages/editor-ports/src",
		expected: true,
		note: "the exact contract directory root is part of the contract",
	},
	{
		path: "packages/editor-ports/src-extra",
		expected: false,
		note: "a neighboring prefix is not mistaken for the contract",
	},
];

function runNegativeControl() {
	console.log("check-port-boundary: negative control");
	let allAsExpected = true;
	for (const fixture of CONTRACT_PATH_CONTROL_FIXTURES) {
		const recognized = isContractPath(fixture.path);
		const ok = recognized === fixture.expected;
		if (!ok) allAsExpected = false;
		console.log(
			`  ${ok ? "PASS" : "FAIL"}  contract-path — ${recognized ? "recognized" : "not recognized"}` +
				` (expected ${fixture.expected ? "recognized" : "not recognized"})` +
				` [${fixture.note}]: ${fixture.path}`,
		);
	}
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
		`check-port-boundary: scanned ${files.length} contract module(s) (tracked + uncommitted)`,
	);
	console.log(
		`  EXEMPT  ${REGISTRY_MODULE} — the acquisition mediator; it is what makes every other site unnecessary`,
	);
	for (const area of NON_RUNTIME_AREAS) {
		console.log(`  EXEMPT  ${area.prefix} — ${area.why}`);
	}
	for (const rule of RULES) {
		const hits = violations.filter((v) => v.rule === rule.id);
		console.log(
			`  ${hits.length === 0 ? "PASS" : "FAIL"}  ${rule.id}: ${rule.description}`,
		);
	}

	if (violations.length > 0) {
		console.error("\nPort-boundary violations:");
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
else {
	runCheck();
	try {
		execFileSync(
			process.execPath,
			[join(REPO_ROOT, "script", "check-session-resource-boundary.mjs")],
			{ cwd: REPO_ROOT, stdio: "inherit" },
		);
	} catch {
		process.exit(1);
	}
}

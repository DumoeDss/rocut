#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const negativeIndex = args.indexOf("--negative-control");
const negativeControl =
	negativeIndex === -1 ? null : (args[negativeIndex + 1] ?? null);

const OWNER = "packages/editor-classic/src/editor/runtime/session-core-owner.ts";
const SESSION_FACTORY = "packages/editor-classic/src/editor/session/create-session.ts";
const REQUIRED = [
	"apps/web/src/app/editor/[project_id]/page.tsx",
	"apps/vite-example/src/host/vite-editor-host.tsx",
	OWNER,
	SESSION_FACTORY,
	"apps/vite-example/src/project-picker.tsx",
	"packages/editor-classic/src/sounds/sounds-store.ts",
	"packages/editor-classic/src/sounds/components/assets-view.tsx",
];
// 39 inherited from the donor refactor, plus T3's ProviderPrivateCompositeCommand
// (`commands/provider-private-composite.ts`, added by 545dc1f9 "route UI commits
// through transactions"). T3 added the module without moving this constant, so
// the gate has been red since 2026-08-10 — through R2 and T4, neither of whose
// gate lists included it. The count is a tripwire against the walk silently
// under-collecting, not a budget: move it when a command module is added.
const EXPECTED_COMMAND_MODULES = 40;
const NEGATIVE_FIXTURES = {
	"singleton-accessor": "get-instance.ts.fixture",
	"singleton-reset": "reset.ts.fixture",
	"static-core-instance": "static-instance.ts.fixture",
	"module-scope-construction": "module-scope-construction.ts.fixture",
	"construction-outside-owner": "outside-owner-construction.ts.fixture",
	"owner-wrapper-outside-route": "outside-owner-wrapper.ts.fixture",
	"session-key-required": "current-session-route.ts.fixture",
	"use-editor-no-selector": "use-editor-no-selector.ts.fixture",
	"use-editor-alias": "use-editor-alias.ts.fixture",
	"use-editor-optional": "use-editor-optional.ts.fixture",
	"empty-subscriber": "empty-subscriber.ts.fixture",
	"empty-subscriber-facade": "empty-subscriber-facade.ts.fixture",
};

function walk(directory) {
	return readdirSync(directory).flatMap((name) => {
		const path = resolve(directory, name);
		return statSync(path).isDirectory() ? walk(path) : [path];
	});
}

function sourceFilesUnder(directory) {
	return walk(resolve(repoRoot, directory))
		.filter((path) => /\.[cm]?[jt]sx?$/.test(path))
		.filter((path) => !path.includes("__tests__"))
		.filter((path) => !/\.test\.[jt]sx?$/.test(path));
}

const files = [
	...sourceFilesUnder("apps/web/src"),
	...sourceFilesUnder("apps/vite-example/src"),
	// s05-second-host: the desktop Host's renderer is a third consumer of the
	// session graph and is policed by the same singleton/construction rules.
	...sourceFilesUnder("apps/electron-host/src"),
	// S05 P1 Stage C moved the editor runtime graph (session owner, session
	// factory, and everything else that used to live under apps/web/src/editor
	// and its sibling domain folders) into @opencut/editor-classic. Without this
	// the walk only sees the residual apps/web/src Host shell and silently
	// under-collects the very construction sites this check exists to police.
	...sourceFilesUnder("packages/editor-classic/src"),
];
const sources = files.map((path) => ({
	path: relative(repoRoot, path).replaceAll("\\", "/"),
	source: readFileSync(path, "utf8"),
}));
const byPath = new Map(sources.map((entry) => [entry.path, entry.source]));

const completenessFailures = [];
for (const required of REQUIRED) {
	if (!byPath.has(required)) {
		completenessFailures.push(`missing-required-root:${required}`);
	}
}

const commandDirectory = resolve(repoRoot, "packages/editor-classic/src/commands");
const commandModules = walk(commandDirectory)
	.filter((path) => path.endsWith(".ts"))
	.filter((path) => !path.endsWith("batch-command.ts"))
	.filter((path) => /\bextends\s+Command\b/.test(readFileSync(path, "utf8")))
	.map((path) => relative(repoRoot, path).replaceAll("\\", "/"));
if (commandModules.length !== EXPECTED_COMMAND_MODULES) {
	completenessFailures.push(
		`command-module-count:${commandModules.length}/${EXPECTED_COMMAND_MODULES}`,
	);
}
for (const command of commandModules) {
	if (!byPath.has(command)) {
		completenessFailures.push(`missing-command-module:${command}`);
	}
}
if (sources.length < 100) {
	completenessFailures.push(`truncated-runtime-graph:${sources.length}`);
}

if (negativeControl !== null) {
	const fixture = NEGATIVE_FIXTURES[negativeControl];
	if (!fixture) {
		console.error(
			`check-editor-singleton: unknown negative control ${negativeControl ?? "<missing>"}`,
		);
		process.exit(2);
	}
	const fixturePath = resolve(
		repoRoot,
		"script/fixtures/editor-singleton-negative",
		fixture,
	);
	if (!existsSync(fixturePath)) {
		console.error(`check-editor-singleton: missing fixture ${fixture}`);
		process.exit(2);
	}
	sources.push({
		path: `negative-control/${fixture}`,
		source: readFileSync(fixturePath, "utf8"),
	});
}

const violations = completenessFailures.map((detail) => ({
	rule: "runtime-graph-completeness",
	path: detail,
}));
let ownerConstructionCount = 0;
let ownerWrapperRouteCount = 0;

for (const entry of sources) {
	const { path, source } = entry;
	const uncommented = source
		.replace(/\/\*[\s\S]*?\*\//g, " ")
		.replace(/\/\/.*$/gm, " ");
	if (/\bEditorCore\s*\.\s*getInstance\s*\(/.test(source)) {
		violations.push({ rule: "singleton-accessor", path });
	}
	if (/\bEditorCore\s*\.\s*reset\s*\(/.test(source)) {
		violations.push({ rule: "singleton-reset", path });
	}
	if (
		/\bstatic\s+(?:readonly\s+)?(?:instance|editor|core)\s*(?::[^;=]+)?[=;]/.test(
			source,
		)
	) {
		violations.push({ rule: "static-core-instance", path });
	}
	if (
		/^(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*(?:EditorCore\.createSessionOwned\(\)|new\s+EditorCore\s*\()/m.test(
			source,
		)
	) {
		violations.push({ rule: "module-scope-construction", path });
	}

	const constructions = source
		.split(/\r?\n/)
		.filter(
			(line) =>
				/\bEditorCore\.createSessionOwned\s*\(/.test(line) &&
				!/\bstatic\s+createSessionOwned\s*\(/.test(line),
		).length;
	if (path === OWNER) {
		ownerConstructionCount += constructions;
	} else if (constructions > 0) {
		violations.push({ rule: "construction-outside-owner", path });
	}

	const directConstructions =
		source.match(/\bnew\s+EditorCore\s*\(/g)?.length ?? 0;
	if (directConstructions > 0 && path !== "packages/editor-classic/src/core/index.ts") {
		violations.push({ rule: "construction-outside-owner", path });
	}

	const ownerWrapperCalls = source
		.split(/\r?\n/)
		.filter(
			(line) =>
				/\bcreateOwnedSessionEditor\s*\(/.test(line) &&
				!/\bfunction\s+createOwnedSessionEditor\s*\(/.test(line),
		).length;
	if (path === SESSION_FACTORY) {
		ownerWrapperRouteCount += ownerWrapperCalls;
	} else if (ownerWrapperCalls > 0) {
		violations.push({ rule: "owner-wrapper-outside-route", path });
	}

	if (
		/\beditorForSession\s*\(\s*\)/.test(source) ||
		/\bcreateOwnedSessionEditor\s*\(\s*\)/.test(source) ||
		/^(?:export\s+)?(?:const|let|var)\s+(?:currentSession|defaultSession)\b/m.test(
			source,
		) ||
		/\b(?:getCurrentSession|setCurrentSession)\s*\(/.test(source)
	) {
		violations.push({ rule: "session-key-required", path });
	}

	const editorAliases = new Set(["useEditor"]);
	for (const match of source.matchAll(
		/import\s*{([^}]+)}\s*from\s*["']@\/editor\/use-editor["']/g,
	)) {
		for (const part of match[1].split(",")) {
			const alias = /\buseEditor\s+as\s+(\w+)/.exec(part)?.[1];
			if (alias) editorAliases.add(alias);
		}
	}
	for (const alias of editorAliases) {
		if (
			new RegExp("\\b" + alias + "\\s*(?:\\?\\.)?\\s*\\(\\s*\\)").test(
				uncommented,
			)
		) {
			violations.push({ rule: "use-editor-no-selector", path });
		}
	}
	if (/\bsubscribeNone\b/.test(uncommented)) {
		violations.push({ rule: "empty-subscriber", path });
	}
	if (
		/useSyncExternalStore\s*\(\s*\(\s*\)\s*=>\s*\(\s*\)\s*=>\s*\{?\s*\}?/s.test(
			uncommented,
		)
	) {
		violations.push({ rule: "empty-subscriber-facade", path });
	}
}

if (ownerConstructionCount !== 1) {
	violations.push({
		rule: "session-owner-construction-count",
		path: `${OWNER}:${ownerConstructionCount}`,
	});
}
if (ownerWrapperRouteCount !== 1) {
	violations.push({
		rule: "session-owner-wrapper-route-count",
		path: `${SESSION_FACTORY}:${ownerWrapperRouteCount}`,
	});
}

console.error(
	`check-editor-singleton: scanned ${sources.length} runtime module(s), ` +
		`${commandModules.length} command module(s)`,
);

if (violations.length > 0) {
	for (const violation of violations) {
		console.error(`  FAIL ${violation.rule}: ${violation.path}`);
	}
	process.exit(1);
}

console.error(
	"  PASS explicit-session-only: one core construction in the session owner; " +
		"no static accessor, reset, default session or out-of-owner construction",
);

#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const negativeIndex = args.indexOf("--negative-control");
const negativeControl =
	negativeIndex === -1 ? null : (args[negativeIndex + 1] ?? null);

const OWNER = "apps/web/src/editor/runtime/session-core-owner.ts";
const REQUIRED = [
	"apps/web/src/app/editor/[project_id]/page.tsx",
	"apps/vite-example/src/host/vite-editor-host.tsx",
	OWNER,
	"apps/web/src/editor/session/create-session.ts",
	"apps/vite-example/src/project-picker.tsx",
	"apps/web/src/sounds/sounds-store.ts",
	"apps/web/src/sounds/components/assets-view.tsx",
];
const EXPECTED_COMMAND_MODULES = 39;
const NEGATIVE_FIXTURES = {
	"singleton-accessor": "get-instance.ts.fixture",
	"singleton-reset": "reset.ts.fixture",
	"static-core-instance": "static-instance.ts.fixture",
	"module-scope-construction": "module-scope-construction.ts.fixture",
	"construction-outside-owner": "outside-owner-construction.ts.fixture",
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

const commandDirectory = resolve(repoRoot, "apps/web/src/commands");
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

for (const entry of sources) {
	const { path, source } = entry;
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
	if (directConstructions > 0 && path !== "apps/web/src/core/index.ts") {
		violations.push({ rule: "construction-outside-owner", path });
	}

	if (/\beditorForSession\s*\(\s*\)/.test(source)) {
		violations.push({ rule: "session-key-required", path });
	}
}

if (ownerConstructionCount !== 1) {
	violations.push({
		rule: "session-owner-construction-count",
		path: `${OWNER}:${ownerConstructionCount}`,
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

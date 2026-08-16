#!/usr/bin/env node
/**
 * Materialize and execute the adapter-author template from packed tarballs.
 *
 * The successful scratch project is intentionally left at the printed path so
 * an author can inspect and copy it. A later run may replace only the same
 * marker-owned root through the shared fail-closed lifecycle.
 */
import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createScratchHarness } from "./scratch-install-harness.mjs";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(MODULE_DIR, "..");
const TEMPLATE_ROOT = join(REPO_ROOT, "templates", "adapter-project");
const IS_WINDOWS = process.platform === "win32";
const NPM = IS_WINDOWS ? "npm.cmd" : "npm";

export const ADAPTER_AUTHOR_STEP_IDS = Object.freeze([
	"author/materialize",
	"author/pack",
	"author/install",
	"author/controls",
	"author/typecheck",
	"author/conformance",
	"author/migration",
	"author/failure-demo",
]);

function defineAuthorCommand(id, executable, args) {
	const frozenArgs = Object.freeze([...args]);
	return Object.freeze({
		id,
		executable,
		args: frozenArgs,
		command: [executable, ...frozenArgs].join(" "),
	});
}

export const ADAPTER_AUTHOR_COMMANDS = Object.freeze([
	defineAuthorCommand("author/materialize", "node", [
		"script/run-adapter-author-template.mjs",
	]),
	defineAuthorCommand("author/typecheck", "npm", ["run", "typecheck"]),
	defineAuthorCommand("author/conformance", "npm", ["run", "run"]),
	defineAuthorCommand("author/migration", "npm", ["run", "run:mock"]),
	defineAuthorCommand("author/failure-demo", "npm", ["run", "failure-demo"]),
]);
export const ADAPTER_AUTHOR_COMMAND_IDS = Object.freeze(
	ADAPTER_AUTHOR_COMMANDS.map(({ id }) => id),
);

const harness = createScratchHarness({
	label: "run-adapter-author-template",
	repoRoot: REPO_ROOT,
	defaultScratchName: "opencut-adapter-author-template",
	scratchProjectName: "opencut-adapter-author-template",
	markerCreatedBy: "script/run-adapter-author-template.mjs",
});
const {
	fail,
	resolveScratchRoot,
	freshLifecycle,
	stageTarballs,
	install,
	controlCopiesNotLinks,
	controlReact,
	runLogged,
} = harness;

function resolveCommandExecutable(executable) {
	return executable === "npm" ? NPM : executable;
}

function runAuthorCommand(id, options) {
	const descriptor = ADAPTER_AUTHOR_COMMANDS.find((entry) => entry.id === id);
	if (!descriptor) throw new Error(`unknown adapter-author command: ${id}`);
	console.log(`AUTHOR_STEP[${descriptor.id}]: begin`);
	return runLogged(
		descriptor.id,
		resolveCommandExecutable(descriptor.executable),
		descriptor.args,
		options,
	);
}

function completedStep(id, run) {
	console.log(`AUTHOR_STEP[${id}]: begin`);
	try {
		const result = run();
		console.log(`REAL_EXIT_CODE[${id}]:0`);
		return result;
	} catch (error) {
		fail(id, error instanceof Error ? error.message : String(error));
	}
}

function requireGreenStep(id, result) {
	if (result.code !== 0) fail(id, "command failed — see output above");
	return result.output;
}

function rewriteManifest(projectRoot, staged) {
	if (staged.length !== 4) {
		throw new Error(
			`expected exactly four staged tarballs, found ${staged.length}`,
		);
	}
	const byName = new Map();
	for (const entry of staged) {
		if (byName.has(entry.name)) {
			throw new Error(`duplicate staged tarball for ${entry.name}`);
		}
		byName.set(entry.name, entry.spec);
	}
	for (const name of [
		"@opencut/editor-ports",
		"@opencut/editor-contracts",
		"@opencut/editor-classic",
		"opencut-wasm",
	]) {
		if (!byName.has(name)) throw new Error(`no staged tarball for ${name}`);
	}

	const manifestPath = join(projectRoot, "package.json");
	const committed = JSON.parse(readFileSync(manifestPath, "utf8"));
	const dependencies = { ...(committed.dependencies ?? {}) };
	const rewrittenNames = [];
	for (const [name, expectedVersion] of Object.entries(dependencies)) {
		if (!name.startsWith("@opencut/")) continue;
		if (!/^\d+\.\d+\.\d+$/.test(expectedVersion)) {
			throw new Error(
				`${name} expected version is not exact: ${expectedVersion}`,
			);
		}
		const spec = byName.get(name);
		const packedVersion = /-(\d+\.\d+\.\d+(?:-[\w.-]+)?)\.tgz$/.exec(spec)?.[1];
		if (packedVersion !== expectedVersion) {
			throw new Error(
				`${name} expects ${expectedVersion}, packed tarball is ${packedVersion ?? "unparseable"}`,
			);
		}
		dependencies[name] = spec;
		rewrittenNames.push(name);
	}
	if (rewrittenNames.length !== 3) {
		throw new Error(
			`expected three direct @opencut dependencies, rewrote ${rewrittenNames.length}`,
		);
	}
	const overrides = Object.fromEntries([
		...rewrittenNames.map((name) => [name, byName.get(name)]),
		["opencut-wasm", byName.get("opencut-wasm")],
	]);
	const materialized = { ...committed, dependencies, overrides };
	const text = `${JSON.stringify(materialized, null, 2)}\n`;
	if (text.includes("workspace:")) {
		throw new Error("materialized manifest retained a workspace: resolution");
	}
	writeFileSync(manifestPath, text);
	console.log(
		`manifest: ${rewrittenNames.length} direct SDK specs + wasm override rewritten to file: tarballs`,
	);
}

function parsePopulations(output) {
	return {
		ports: /suites\/ports: passed=true cases=(\d+)/.exec(output)?.[1],
		transaction: /suites\/transaction: passed=true cases=(\d+)/.exec(
			output,
		)?.[1],
		engine: /suites\/engine: passed=true cases=(\d+)/.exec(output)?.[1],
		draft: /suites\/draft: passed=true cases=(\d+)/.exec(output)?.[1],
		vectors: /suites\/vectors: verdict=passed vectors=(\d+)/.exec(output)?.[1],
	};
}

const scratchRoot = resolveScratchRoot();
freshLifecycle(scratchRoot);
const projectRoot = join(scratchRoot, "adapter-project");

completedStep("author/materialize", () => {
	if (!existsSync(TEMPLATE_ROOT)) {
		throw new Error(`template missing at ${TEMPLATE_ROOT}`);
	}
	if (existsSync(join(TEMPLATE_ROOT, "node_modules"))) {
		throw new Error("source template contains node_modules");
	}
	cpSync(TEMPLATE_ROOT, projectRoot, { recursive: true });
	console.log(`materialize: copied template to ${projectRoot}`);
});

completedStep("author/pack", () => {
	const staged = stageTarballs(projectRoot);
	rewriteManifest(projectRoot, staged);
});

console.log("AUTHOR_STEP[author/install]: begin");
install(projectRoot, "author/install");

completedStep("author/controls", () => {
	controlCopiesNotLinks(projectRoot);
	controlReact(projectRoot, "absent");
	const manifestText = readFileSync(join(projectRoot, "package.json"), "utf8");
	const lock = JSON.parse(
		readFileSync(join(projectRoot, "package-lock.json"), "utf8"),
	);
	const linkedEntries = Object.entries(lock.packages ?? {}).filter(
		([, entry]) =>
			entry?.link === true ||
			String(entry?.resolved ?? "").startsWith("workspace:"),
	);
	if (manifestText.includes("workspace:") || linkedEntries.length > 0) {
		throw new Error(
			`materialized manifest or ${linkedEntries.length} lockfile resolution(s) retained workspace/link behavior`,
		);
	}
	console.log(
		`CONTROL-author-lockfile: PASS (${Object.keys(lock.packages ?? {}).length} package entries; workspace resolutions=0, link entries=0)`,
	);
});

requireGreenStep(
	"author/typecheck",
	runAuthorCommand("author/typecheck", {
		cwd: projectRoot,
	}),
);

const conformanceOutput = requireGreenStep(
	"author/conformance",
	runAuthorCommand("author/conformance", {
		cwd: projectRoot,
	}),
);
const populations = parsePopulations(conformanceOutput);
if (
	Object.values(populations).some(
		(population) => population === undefined || Number(population) <= 0,
	)
) {
	fail(
		"author/conformance",
		`missing or zero suite population: ${JSON.stringify(populations)}`,
	);
}
if (
	!conformanceOutput.includes("classic chain: loaded (31 steps, target v31)") ||
	!conformanceOutput.includes("migration/by-replication: green") ||
	!conformanceOutput.includes("migration exercised")
) {
	fail(
		"author/conformance",
		"production leg did not load the real 31-step chain and exercise migration",
	);
}
console.log(
	`AUTHOR_POPULATIONS: ${Object.entries(populations)
		.map(([name, count]) => `${name}=${count}`)
		.join(", ")}`,
);

const migrationOutput = requireGreenStep(
	"author/migration",
	runAuthorCommand("author/migration", {
		cwd: projectRoot,
	}),
);
if (
	!migrationOutput.includes("31 steps, target v31") ||
	!migrationOutput.includes("migration/by-replication: green") ||
	!migrationOutput.includes("migration exercised")
) {
	fail(
		"author/migration",
		"mock-installed compatibility leg did not validate the real 31-step chain",
	);
}

const failureOutput = requireGreenStep(
	"author/failure-demo",
	runAuthorCommand("author/failure-demo", {
		cwd: projectRoot,
	}),
);
if (
	!failureOutput.includes("6 expected failures") ||
	!failureOutput.includes("requirement -> case -> detail") ||
	!/\[transaction-automation-api \/ .+\]\s+[\s\S]*case: [^\n]+\s+[\s\S]*detail: /m.test(
		failureOutput,
	) ||
	/\n\s*at\s|    at /.test(failureOutput)
) {
	fail(
		"author/failure-demo",
		"failure output lost requirement-first ordering or gained a stack frame",
	);
}

console.log(`author template: materialized project retained at ${projectRoot}`);
console.log("REAL_EXIT_CODE[author-runner]:0");

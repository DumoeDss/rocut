#!/usr/bin/env node
/**
 * Adapter-project seed and drift guard.
 *
 * It keeps the copyable asset attributable to the P3/P6 alien adapter while
 * proving the template contains only its declared inventory, imports only
 * declared package entries, preserves the flat JSON-tuple representation and
 * opaque round trip, and still executes all five non-empty suites.
 */
import { spawnSync } from "node:child_process";
import {
	existsSync,
	readdirSync,
	readFileSync,
	statSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE_ROOT = join(REPO_ROOT, "templates", "adapter-project");
const SEED_ROOT = join(REPO_ROOT, "examples", "custom-storage");
const WORKFLOW_PATH = join(REPO_ROOT, ".github", "workflows", "bun-ci.yml");
const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)["']([^"']+)["']/g;

function fail(message) {
	console.error(`check-adapter-project-template: ${message}`);
	console.log("REAL_EXIT_CODE[template-drift]:1");
	process.exit(1);
}

function walk(root, prefix = "") {
	const files = [];
	for (const name of readdirSync(join(root, prefix)).sort()) {
		const path = prefix ? `${prefix}/${name}` : name;
		const absolute = join(root, path);
		if (statSync(absolute).isDirectory()) files.push(...walk(root, path));
		else files.push(path);
	}
	return files;
}

function run(step, command, args, cwd = REPO_ROOT) {
	const invocation =
		process.platform === "win32"
			? [`${command} ${args.join(" ")}`, []]
			: [command, args];
	const result = spawnSync(invocation[0], invocation[1], {
		cwd,
		shell: process.platform === "win32",
		encoding: "utf8",
		maxBuffer: 256 * 1024 * 1024,
	});
	const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
	if (result.status !== 0) {
		if (output) console.error(output);
		fail(`${step} exited ${result.status ?? -1}`);
	}
	return output;
}

if (!existsSync(TEMPLATE_ROOT)) fail(`template missing at ${TEMPLATE_ROOT}`);
const metadata = JSON.parse(
	readFileSync(join(TEMPLATE_ROOT, "template.json"), "utf8"),
);
if (
	metadata.schema !== "opencut-adapter-project/v1" ||
	metadata.representation !== "flat-json-tuple-map" ||
	metadata.declaredEntryOnly !== true
) {
	fail("template.json lost its schema, alien representation, or declared-entry-only ruling");
}

const declaredFiles = new Set([
	"README.md",
	"package.json",
	"template.json",
	"tsconfig.json",
	...Object.values(metadata.authorOwned),
	...Object.values(metadata.executables),
	...Object.values(metadata.guards),
	...metadata.support,
]);
const actualFiles = walk(TEMPLATE_ROOT);
const missing = [...declaredFiles].filter((path) => !actualFiles.includes(path));
const extra = actualFiles.filter((path) => !declaredFiles.has(path));
if (missing.length > 0 || extra.length > 0) {
	fail(
		`inventory drift (missing: ${missing.join(", ") || "none"}; extra/untracked internals: ${extra.join(", ") || "none"})`,
	);
}
console.log(
	`template-drift/inventory: PASS (${actualFiles.length} declared files, 0 extras)`,
);

const byteIdenticalSeedFiles = [
	"src/alien-codec.ts",
	"src/alien-control.ts",
	"src/alien-store.ts",
	"src/migrate.ts",
	"src/roles.ts",
	"src/transaction.ts",
	"types/culori.d.ts",
];
for (const path of byteIdenticalSeedFiles) {
	const template = readFileSync(join(TEMPLATE_ROOT, path));
	const seed = readFileSync(join(SEED_ROOT, path));
	if (!template.equals(seed)) fail(`${path} drifted from the declared P6 seed`);
}
const storeSource = readFileSync(
	join(TEMPLATE_ROOT, "src", "alien-store.ts"),
	"utf8",
);
for (const anchor of [
	"new Map<string, string>()",
	'JSON.stringify(["project", id])',
	"alienText(value)",
	"fromAlienText(text)",
]) {
	if (!storeSource.includes(anchor)) fail(`alien representation anchor missing: ${anchor}`);
}
console.log(
	`template-drift/alien-seed: PASS (${byteIdenticalSeedFiles.length} seed files byte-identical; flat JSON-tuple anchors present)`,
);

const manifests = new Map();
for (const directory of ["editor-ports", "editor-contracts", "editor-classic"]) {
	const manifest = JSON.parse(
		readFileSync(join(REPO_ROOT, "packages", directory, "package.json"), "utf8"),
	);
	manifests.set(manifest.name, manifest);
}
let importCount = 0;
for (const path of actualFiles.filter((candidate) => candidate.endsWith(".ts"))) {
	const absolute = join(TEMPLATE_ROOT, path);
	const source = readFileSync(absolute, "utf8");
	for (const match of source.matchAll(IMPORT_RE)) {
		const specifier = match[1];
		importCount += 1;
		if (specifier.startsWith(".")) {
			const base = resolve(dirname(absolute), specifier);
			const candidates = [base, `${base}.ts`, join(base, "index.ts")];
			const resolved = candidates.find((candidate) => existsSync(candidate));
			if (!resolved || !resolved.startsWith(`${TEMPLATE_ROOT}${process.platform === "win32" ? "\\" : "/"}`)) {
				fail(`${path} imports a missing or out-of-template relative module: ${specifier}`);
			}
			continue;
		}
		const packageName = [...manifests.keys()].find(
			(name) => specifier === name || specifier.startsWith(`${name}/`),
		);
		if (!packageName) fail(`${path} imports an undeclared package: ${specifier}`);
		const subpath =
			specifier === packageName
				? "."
				: `./${specifier.slice(packageName.length + 1)}`;
		if (!Object.hasOwn(manifests.get(packageName).exports ?? {}, subpath)) {
			fail(`${path} deep-imports undeclared entry ${specifier}`);
		}
	}
}
console.log(
	`template-drift/declared-imports: PASS (${importCount} import specifiers; 0 undeclared or out-of-template paths)`,
);

const workflow = readFileSync(WORKFLOW_PATH, "utf8");
const sdkExamplesStart = workflow.indexOf("  sdk-examples:");
if (sdkExamplesStart < 0) fail("sdk-examples CI job is missing");
const sdkExamples = workflow.slice(sdkExamplesStart);
const dependencyInstall = sdkExamples.indexOf("run: bun install --frozen-lockfile");
const driftExecution = sdkExamples.indexOf(
	"node script/check-adapter-project-template.mjs",
);
if (
	dependencyInstall < 0 ||
	driftExecution < 0 ||
	dependencyInstall > driftExecution
) {
	fail(
		"sdk-examples must install the locked root workspace before executing the template drift check",
	);
}
console.log(
	"template-drift/ci-dependencies: PASS (locked root workspace install precedes drift execution)",
);

const opaqueOutput = run(
	"opaque round trip",
	"bun",
	["templates/adapter-project/seed-check.ts"],
);
if (!opaqueOutput.includes("seed-check/opaque-round-trip: PASS")) {
	fail("opaque round-trip probe did not print its PASS population");
}
console.log(opaqueOutput);

const suiteOutput = run(
	"five-suite template run",
	"bun",
	["templates/adapter-project/run.ts"],
);
const populations = {
	ports: /suites\/ports: passed=true cases=(\d+)/.exec(suiteOutput)?.[1],
	transaction: /suites\/transaction: passed=true cases=(\d+)/.exec(suiteOutput)?.[1],
	engine: /suites\/engine: passed=true cases=(\d+)/.exec(suiteOutput)?.[1],
	draft: /suites\/draft: passed=true cases=(\d+)/.exec(suiteOutput)?.[1],
	vectors: /suites\/vectors: verdict=passed vectors=(\d+)/.exec(suiteOutput)?.[1],
};
if (
	Object.values(populations).some(
		(population) => population === undefined || Number(population) <= 0,
	)
) {
	fail(`five-suite population missing or zero: ${JSON.stringify(populations)}`);
}
console.log(
	`template-drift/five-suites: PASS (${Object.entries(populations)
		.map(([name, count]) => `${name}=${count}`)
		.join(", ")})`,
);
console.log("REAL_EXIT_CODE[template-drift]:0");

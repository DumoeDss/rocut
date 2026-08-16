// The install-packages verification script (S05 P6 task 3.1).
//
// What an adopter verifies the moment the packages land: the declared
// React-free entries resolve, the resolved versions match the pins, the
// shipped surface.json and policy README read as the data they are, and
// classic's installed metadata is sane — all WITHOUT importing classic's
// runtime, whose React peer this example deliberately leaves unsatisfied
// (the CONTROL-react-free pattern; the React-bearing surface belongs to the
// embed-surface example).
import { existsSync, readFileSync } from "node:fs";

import { PORT_ROLES } from "@opencut/editor-ports";
import { createInMemoryProjectStoreFixture } from "@opencut/editor-ports/in-memory";
import {
	INITIAL_REVISION,
	OPERATION_KINDS,
	createInMemoryTransactionStore,
} from "@opencut/editor-contracts";
import { TRANSACTION_VECTOR_SCHEMA } from "@opencut/editor-contracts/vectors";
import {
	PUBLISHED_CONTRACT_SURFACE,
	readPublishedCorpusText,
} from "@opencut/editor-contracts/vectors/corpus";

const PINS: Readonly<Record<string, string>> = {
	"@opencut/editor-ports": "0.2.0",
	"@opencut/editor-contracts": "0.3.0",
	"@opencut/editor-classic": "0.2.0",
};
const POLICY_ANCHOR = "Compatibility policy (`0.x`)";

const failures: string[] = [];
function check(ok: boolean, label: string): void {
	console.log(`${ok ? "ok  " : "FAIL"} ${label}`);
	if (!ok) failures.push(label);
}

function installedManifest(pkg: string): Record<string, unknown> {
	return JSON.parse(readFileSync(`node_modules/${pkg}/package.json`, "utf8"));
}
function installedText(pkg: string, file: string): string {
	return readFileSync(`node_modules/${pkg}/${file}`, "utf8");
}
function surfaceClass(pkg: string, entry: string): string {
	const surface = JSON.parse(installedText(pkg, "surface.json"));
	return surface.entries[entry]?.class ?? "(unclassified)";
}
function sortedCsv(values: readonly string[]): string {
	return [...values].sort().join(",");
}

// (1) The declared React-free entries resolve and do their thing.
const fixture = createInMemoryProjectStoreFixture();
const store = createInMemoryTransactionStore();
check(PORT_ROLES.length > 0, `ports root exports PORT_ROLES (${PORT_ROLES.length} roles: ${PORT_ROLES.join(", ")})`);
check(typeof fixture.store === "object" && fixture.store !== null, "ports in-memory fixture store constructs");
check(typeof store.apply === "function", "contracts root transaction store constructs (apply is callable)");
check(INITIAL_REVISION === 0, `contracts root exports INITIAL_REVISION (${INITIAL_REVISION})`);

// (2) The published corpus ships whole: manifest + corpus files + the frozen
// surface as data, and the two frozen views of the operation kinds agree.
const corpus = readPublishedCorpusText();
const corpusFiles = Object.keys(corpus.files).length;
check(corpus.manifestText.length > 0 && corpusFiles > 0, `vectors/corpus reads the published corpus (manifest + ${corpusFiles} file(s))`);
check(
	sortedCsv(OPERATION_KINDS) === sortedCsv(PUBLISHED_CONTRACT_SURFACE.operationKinds),
	`OPERATION_KINDS agrees with PUBLISHED_CONTRACT_SURFACE (${PUBLISHED_CONTRACT_SURFACE.operationKinds.length} kinds)`,
);
check(Boolean(TRANSACTION_VECTOR_SCHEMA), `vectors exports TRANSACTION_VECTOR_SCHEMA (${TRANSACTION_VECTOR_SCHEMA})`);

// (3) Resolved versions: what landed in node_modules matches the pin.
for (const [pkg, pin] of Object.entries(PINS)) {
	const version = String(installedManifest(pkg).version);
	check(version === pin, `${pkg} resolved at ${version} (pinned ${pin})`);
}

// (4) The installed surface.json, read as the data an adopter reads it: every
// entry this example imports carries the class the README table claims.
const expectedClasses: Array<[string, string, string]> = [
	["@opencut/editor-ports", ".", "frozen"],
	["@opencut/editor-ports", "./in-memory", "frozen"],
	["@opencut/editor-contracts", ".", "frozen"],
	["@opencut/editor-contracts", "./vectors", "frozen"],
	["@opencut/editor-contracts", "./vectors/corpus", "frozen"],
];
for (const [pkg, entry, expected] of expectedClasses) {
	const actual = surfaceClass(pkg, entry);
	check(actual === expected, `${pkg}${entry} classified ${actual} (expected ${expected})`);
}

// (5) The policy README ships where an adopter looks for it.
for (const pkg of ["@opencut/editor-ports", "@opencut/editor-contracts", "@opencut/editor-classic"]) {
	const readme = installedText(pkg, "README.md");
	check(readme.includes(POLICY_ANCHOR), `${pkg} README carries the policy statement`);
}

// (6) classic's installed metadata, asserted WITHOUT importing its runtime.
const classic = installedManifest("@opencut/editor-classic");
const classicExports = Object.keys((classic.exports ?? {}) as Record<string, unknown>);
for (const entry of ["./surface", "./surface.css", "./storage/migrations"]) {
	check(classicExports.includes(entry), `classic exports map declares ${entry}`);
}
check(
	(classic.peerDependencies as Record<string, string> | undefined)?.react === "^18.3.1",
	"classic declares its React peer (unsatisfied here by design)",
);
check(!existsSync("node_modules/react"), "node_modules/react does not exist — classic's React peer is unsatisfied, the runtime unimported");
check(
	surfaceClass("@opencut/editor-classic", "./storage/migrations") === "provider",
	"classic ./storage/migrations classified provider (read as data, not imported)",
);

if (failures.length > 0) {
	console.error(`install-packages: ${failures.length} assertion(s) failed`);
	process.exit(1);
}
console.log("install-packages: every assertion green — the packages install, resolve and self-describe from the tarballs");

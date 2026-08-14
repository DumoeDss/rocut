#!/usr/bin/env node
/** Fail-closed React 18 singleton check across manifests, lock, emitted graph, and probe shape. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXACT = { react: "18.3.1", "react-dom": "18.3.1", "@types/react": "18.3.28", "@types/react-dom": "18.3.7" };
const MANIFESTS = ["package.json", "apps/web/package.json", "apps/vite-example/package.json"];
const GRAPH = "apps/vite-example/dist/module-graph.json";
const PROBE = "packages/editor-classic/src/editor/surface/embedding/surface-react-identity-probe.tsx";

function manifestHits(path, manifest) {
	const hits = [];
	for (const [name, version] of Object.entries(EXACT)) {
		const declared = manifest.dependencies?.[name] ?? manifest.devDependencies?.[name];
		if (declared !== version) hits.push(`${path}: ${name} must equal ${version}, got ${declared ?? "missing"}`);
	}
	return hits;
}

function lockRoots(lock) {
	const roots = {};
	for (const name of Object.keys(EXACT)) {
		const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		roots[name] = new Set([...lock.matchAll(new RegExp(`"${escaped}(?:@[^"\\]]+)?"\\s*:\\s*\\["${escaped}@([^"\\]]+)"`, "g"))].map((match) => match[1]));
	}
	return roots;
}

function graphRoots(modules, packageName) {
	const marker = `/node_modules/${packageName}/`;
	return new Set(modules.filter((id) => id.includes(marker)).map((id) => id.slice(0, id.indexOf(marker) + marker.length - 1)));
}

function check({ manifests, lock, modules, probe }) {
	const hits = MANIFESTS.flatMap((path) => manifestHits(path, manifests[path]));
	for (const [name, roots] of Object.entries(lockRoots(lock))) {
		if (roots.size !== 1 || !roots.has(EXACT[name])) hits.push(`lock: ${name} resolutions are [${[...roots].join(", ")}]`);
	}
	for (const name of ["react", "react-dom"]) {
		const roots = graphRoots(modules, name);
		if (roots.size !== 1) hits.push(`graph: ${name} has ${roots.size} package roots`);
	}
	for (const shape of ["createContext", "useContext", "useState", "useEffect", "hostReactIdentity === surfaceReactIdentity", "invalid-hook-call"]) {
		if (!probe.includes(shape)) hits.push(`probe: missing ${shape}`);
	}
	return hits;
}

function controls(base) {
	const duplicate = { ...base, modules: [...base.modules, "C:/fixture/node_modules/react/index.js"] };
	const sameRoot = { ...base, modules: [...base.modules, ...base.modules.filter((id) => id.includes("/node_modules/react/"))] };
	const duplicateCaught = check(duplicate).some((hit) => hit.startsWith("graph: react has"));
	const baseHits = check(base);
	const conversePasses = check(sameRoot).length === baseHits.length;
	console.log(`  ${duplicateCaught ? "PASS" : "FAIL"} negative — duplicate React root is caught`);
	console.log(`  ${conversePasses ? "PASS" : "FAIL"} converse — repeated modules from one root pass`);
	if (!duplicateCaught || !conversePasses) process.exit(1);
}

const manifests = Object.fromEntries(MANIFESTS.map((path) => [path, JSON.parse(readFileSync(join(ROOT, path), "utf8"))]));
const lock = readFileSync(join(ROOT, "bun.lock"), "utf8");
const graph = JSON.parse(readFileSync(join(ROOT, GRAPH), "utf8"));
const probe = readFileSync(join(ROOT, PROBE), "utf8");
const base = { manifests, lock, modules: graph.modules ?? [], probe };
if (!base.modules.length) {
	console.error("check-react-singleton: emitted graph is empty");
	process.exit(2);
}
if (process.argv.includes("--negative-control") || process.argv.includes("--converse-control")) controls(base);
else {
	const hits = check(base);
	console.log(`check-react-singleton: ${MANIFESTS.length} manifests, lock, ${base.modules.length} emitted modules, runtime probe shape`);
	for (const hit of hits) console.error(`  FAIL ${hit}`);
	if (hits.length) process.exit(1);
	console.log("clean");
}

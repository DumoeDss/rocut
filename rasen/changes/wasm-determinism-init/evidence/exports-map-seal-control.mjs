/**
 * Does adding the `exports` map SEAL anything that resolved before it?
 *
 * The single-sided check (`exports-map-resolution.mjs`) shows what resolves today. It cannot show
 * what the map *changed*, and "adding `exports` seals every undeclared subpath" is the failure
 * mode being guarded against — so this is the A/B: two synthetic packages built from the real
 * emitted manifest, identical except that one has the `exports` map deleted, probed over the same
 * specifier list under both the ESM and CJS resolvers.
 *
 * The A/B shape is the independent reviewer's; kept because it answers the question the one-sided
 * probe cannot. The specifier list deliberately includes `snippets/helper.js` (the manifest's
 * `sideEffects` names `./snippets/*`, so it must stay reachable), an extensionless path, and the
 * bare package root.
 *
 *   node rasen/changes/wasm-determinism-init/evidence/exports-map-seal-control.mjs
 *
 * Scratch defaults to a directory under $HOME — never %TEMP%, which is intercepted by security
 * software on the maintainer's machine, and never inside the repo, where an ancestor
 * `node_modules` would change resolution and invalidate the whole measurement.
 *
 * One row to read carefully: `/sync` reports `esm=ok` even in the no-exports half, where no file
 * of that name exists. That is a resolver property, not a pre-existing path —
 * `import.meta.resolve` returns a URL for a package subpath without checking that it exists once
 * there is no `exports` map to consult. Its `cjs` column, which does check, correctly moves
 * `MODULE_NOT_FOUND -> ok`. The map only ever ADDS a resolvable path here; nothing moves the other
 * way, which is the whole claim.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const SCRATCH =
	process.env.OPENCUT_SEAL_PROBE_ROOT ?? join(homedir(), ".opencut-exports-map-probe");

const SPECIFIERS = [
	"",
	"/opencut_wasm.js",
	"/opencut_wasm_bg.js",
	"/opencut_wasm_sync.js",
	"/opencut_wasm_bg.wasm",
	"/opencut_wasm.d.ts",
	"/package.json",
	"/snippets/helper.js",
	"/sync",
];

const manifest = JSON.parse(
	readFileSync(join(ROOT, "rust", "wasm", "pkg", "package.json"), "utf8"),
);
if (manifest.exports === undefined) {
	console.error("seal-control: the emitted manifest carries no `exports` map; nothing to A/B");
	process.exit(2);
}

rmSync(SCRATCH, { recursive: true, force: true });
for (const [name, withExports] of [
	["pkg-with", true],
	["pkg-without", false],
]) {
	const dir = join(SCRATCH, "node_modules", name);
	mkdirSync(join(dir, "snippets"), { recursive: true });
	const copy = { ...manifest, name };
	if (!withExports) delete copy.exports;
	writeFileSync(join(dir, "package.json"), JSON.stringify(copy, null, 2));
	for (const file of ["opencut_wasm.js", "opencut_wasm_bg.js", "opencut_wasm_sync.js"]) {
		writeFileSync(join(dir, file), "export const x = 1;\n");
	}
	writeFileSync(join(dir, "opencut_wasm.d.ts"), "");
	writeFileSync(join(dir, "opencut_wasm_bg.wasm"), Buffer.alloc(4));
	writeFileSync(join(dir, "snippets", "helper.js"), "export const y = 1;\n");
}
writeFileSync(
	join(SCRATCH, "package.json"),
	JSON.stringify({ name: "seal-probe", type: "module" }, null, 2),
);

// The ESM probe MUST run from a module inside the scratch tree. `import.meta.resolve` resolves
// against the calling module's own URL — a parent-URL second argument is not honoured — so
// probing from this file would resolve against the evidence directory, where neither package is
// installed, and every row would read ERR_MODULE_NOT_FOUND for both halves. That is a vacuous
// leg, not a passing one, and it is exactly what this repository refuses to record as a PASS.
writeFileSync(
	join(SCRATCH, "esm-probe.mjs"),
	`const specifiers = ${JSON.stringify(SPECIFIERS)};
const out = {};
for (const pkg of ["pkg-with", "pkg-without"]) {
	for (const specifier of specifiers) {
		const id = pkg + specifier;
		try { import.meta.resolve(id); out[id] = "ok"; }
		catch (error) { out[id] = error.code ?? error.name; }
	}
}
console.log(JSON.stringify(out));
`,
);
const esmRun = spawnSync(process.execPath, [join(SCRATCH, "esm-probe.mjs")], {
	cwd: SCRATCH,
	encoding: "utf8",
});
if (esmRun.status !== 0) {
	console.error(`seal-control: the ESM probe failed to run\n${esmRun.stderr}`);
	process.exit(2);
}
const esm = JSON.parse(esmRun.stdout.trim().split(/\r?\n/).at(-1));
const require = createRequire(pathToFileURL(join(SCRATCH, "package.json")));
const cjs = (id) => {
	try {
		require.resolve(id);
		return "ok";
	} catch (error) {
		return error.code ?? error.name;
	}
};

// Guard against the vacuity above ever returning silently: the control is only meaningful if the
// no-exports half — the pre-change world — actually resolves things.
const baselineResolvable = SPECIFIERS.filter(
	(s) => esm[`pkg-without${s}`] === "ok" || cjs(`pkg-without${s}`) === "ok",
).length;

let sealed = 0;
const pad = (value, width) => String(value).padEnd(width);
console.log(
	`${pad("specifier", 24)}${pad("without exports", 26)}${pad("with exports", 26)}verdict`,
);
for (const specifier of SPECIFIERS) {
	const before = { esm: esm[`pkg-without${specifier}`], cjs: cjs(`pkg-without${specifier}`) };
	const after = { esm: esm[`pkg-with${specifier}`], cjs: cjs(`pkg-with${specifier}`) };
	// A regression is only a path that resolved BEFORE and does not now.
	const regressed =
		(before.esm === "ok" && after.esm !== "ok") || (before.cjs === "ok" && after.cjs !== "ok");
	if (regressed) sealed += 1;
	console.log(
		`${pad(specifier || "(bare)", 24)}${pad(`esm=${before.esm} cjs=${before.cjs}`, 26)}${pad(`esm=${after.esm} cjs=${after.cjs}`, 26)}${regressed ? "SEALED" : "ok"}`,
	);
}

rmSync(SCRATCH, { recursive: true, force: true });

if (baselineResolvable === 0) {
	console.error(
		"\nseal-control: REFUSING — nothing resolved in the no-exports half, so this run compares nothing",
	);
	process.exit(2);
}
console.log(
	`\n${sealed === 0 ? "clean" : "FAILED"} — ${SPECIFIERS.length} specifier(s) x 2 resolvers; ${baselineResolvable} resolved before the map existed, ${sealed} sealed by adding it`,
);
process.exit(sealed === 0 ? 0 : 1);

#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
	API_GATE,
	BASELINE_DTS_SHA,
	BUNDLER_ENTRY,
	CONTROLS,
	EXPECTED,
	POSITIVE_CONTROLS,
	SYNC_ENTRY,
	TRAMPOLINE_EXPORT,
} from "./wasm-api-surface-contract.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PKG = join(ROOT, "rust", "wasm", "pkg");
const SELF = fileURLToPath(import.meta.url);

const sha = (value) => createHash("sha256").update(value).digest("hex");
const read = (path) => readFileSync(path);
const readText = (path) => readFileSync(path, "utf8");
const signature = (entries) => sha([...entries].sort().join("\n"));

/** The `export { … } from "./opencut_wasm_bg.js"` block both entries carry, verbatim. */
const exportBlock = (source) =>
	source.match(/export \{([\s\S]*?)\} from/)?.[1] ?? null;

/** Everything except the compiler-generated trampolines — see TRAMPOLINE_EXPORT. */
const stableExports = (entries) =>
	entries.filter((entry) => !TRAMPOLINE_EXPORT.test(entry.split("|")[0]));

/**
 * The low-level declarations with trampoline hashes replaced by a placeholder, one line per
 * declaration, blank lines dropped. Everything else is compared verbatim.
 */
const normalizedDtsLines = (text) =>
	text
		.split(/\r?\n/)
		.map((line) =>
			line.replace(/(wasm_bindgen__convert__closures_____invoke__h)[0-9a-f]{16}/g, "$1<hash>"),
		)
		.filter((line) => line.trim().length > 0);

/** Symmetric difference against the recorded set, for a failure a human has to act on remotely. */
const exportDelta = (observed) => {
	const recorded = new Set(EXPECTED.wasmExportsAsRecorded);
	const seen = new Set(observed);
	return [
		`observed ${observed.length}, recorded ${EXPECTED.wasmExportsAsRecorded.length}`,
		...observed.filter((entry) => !recorded.has(entry)).sort().map((entry) => `  + ${entry}`),
		...EXPECTED.wasmExportsAsRecorded.filter((entry) => !seen.has(entry)).sort().map((entry) => `  - ${entry}`),
	].join("\n");
};

function loadSurface() {
	const dts = readText(join(PKG, "opencut_wasm.d.ts"));
	const wrapper = readText(join(PKG, BUNDLER_ENTRY));
	const syncEntry = readText(join(PKG, SYNC_ENTRY));
	const bg = readText(join(PKG, "opencut_wasm_bg.js"));
	const wasmDts = readText(join(PKG, "opencut_wasm_bg.wasm.d.ts"));
	const wasm = read(join(PKG, "opencut_wasm_bg.wasm"));
	const module = new WebAssembly.Module(wasm);
	const wrapperBlock = wrapper.match(/export \{([\s\S]*?)\} from/)?.[1] ?? "";
	return {
		files: readdirSync(PKG).sort(),
		hashes: Object.fromEntries(
			readdirSync(PKG).map((name) => [name, sha(read(join(PKG, name)))]),
		),
		dts,
		wrapper,
		syncEntry,
		wasmDts,
		wasmManifest: JSON.parse(readText(join(PKG, "package.json"))),
		wrapperExports: wrapperBlock
			.split(",")
			.map((name) => name.trim())
			.filter(Boolean),
		bgExports: [...bg.matchAll(/^export function (\S+)\(/gm)].map(
			(match) => match[1],
		),
		wasmExports: WebAssembly.Module.exports(module).map(
			(entry) => `${entry.name}|${entry.kind}`,
		),
		wasmImports: WebAssembly.Module.imports(module).map(
			(entry) => `${entry.module}|${entry.name}|${entry.kind}`,
		),
		manifest: JSON.parse(readText(join(ROOT, "package.json"))),
		workflow: readText(join(ROOT, ".github", "workflows", "bun-ci.yml")),
		sourceGate: readText(join(ROOT, "script", "check-wasm-source.mjs")),
	};
}

function aggregateCommands(manifest) {
	return (manifest.scripts?.["check:wasm"] ?? "")
		.split(/\s*&&\s*/)
		.map((command) => command.trim())
		.filter(Boolean);
}

function workflowCommandPosition(workflow, command) {
	for (const match of workflow.matchAll(/^\s*run:\s*(.+?)\s*$/gm)) {
		if (match[1] === command) return match.index;
	}
	return -1;
}

function registeredSourceGates(sourceGate) {
	const block = sourceGate.match(/const GATED = \[([\s\S]*?)\];/)?.[1] ?? "";
	return [...block.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

function classBlock(dts, name) {
	return (
		dts.match(new RegExp(`export class ${name} \\{([\\s\\S]*?)\\n\\}`))?.[1] ??
		""
	);
}

function validate(surface) {
	const errors = [];
	const fail = (id, message) => errors.push(`${id}: ${message}`);
	if (JSON.stringify(surface.files) !== JSON.stringify(EXPECTED.files)) {
		fail("generated-files", `expected ${EXPECTED.files.join(", ")}`);
	}
	for (const [name, hash] of Object.entries(EXPECTED.pinnedHashes)) {
		if (surface.hashes[name] !== hash) {
			fail("generated-files", `${name} differs from the recorded build output`);
		}
	}
	for (const [name, hash] of Object.entries(EXPECTED.changedBaselineHashes)) {
		if (surface.hashes[name] === hash) {
			fail("generated-files", `${name} did not carry the deliberate C0b delta`);
		}
	}
	if (sha(surface.dts) !== EXPECTED.dtsSha) {
		fail(
			"declarations",
			`unexpected declaration delta from ${BASELINE_DTS_SHA}`,
		);
	}
	if (sha(surface.wrapper) !== EXPECTED.wrapperSha) {
		fail("wrapper", "wrapper content differs from the recorded C0b output");
	}
	// The low-level d.ts is generated from the binary's export table, so it carries the same
	// host-varying trampoline hashes. Every other line is still compared verbatim, and the line
	// count is pinned, so an added, removed or edited declaration is caught.
	const observedDtsLines = normalizedDtsLines(surface.wasmDts);
	if (
		observedDtsLines.length !== EXPECTED.wasmDtsLineCount ||
		signature(observedDtsLines) !== EXPECTED.wasmDtsNormalizedSignature
	) {
		const declared = [...surface.wasmDts.matchAll(/^export const (\S+?):/gm)].map((m) => m[1]);
		const recordedNames = new Set(
			EXPECTED.wasmExportsAsRecorded.map((entry) => entry.split("|")[0]),
		);
		const delta = [
			`${observedDtsLines.length} declaration line(s) observed, recorded ${EXPECTED.wasmDtsLineCount}`,
			...declared.filter((name) => !recordedNames.has(name)).sort().map((name) => `  + ${name}`),
			...[...recordedNames]
				.filter((name) => !declared.includes(name) && name !== "__wbindgen_externrefs")
				.sort()
				.map((name) => `  - ${name}`),
		].join("\n");
		fail(
			"binary-declarations",
			`low-level declarations differ from the recorded output\n${delta}`,
		);
	}
	if (signature(surface.wrapperExports) !== EXPECTED.wrapperExportSignature) {
		fail(
			"wrapper-exports",
			"public JS export set is not the exact recorded set of 38",
		);
	}
	if (signature(surface.bgExports) !== EXPECTED.bgExportSignature) {
		fail(
			"glue-exports",
			"generated glue export set is not the exact recorded set of 646",
		);
	}
	// Self-consistency: the recorded diagnostic list must still hash to the recorded stable
	// signature once its trampolines are removed, so the list cannot rot into decoration while the
	// signature does the real work.
	if (signature(stableExports(EXPECTED.wasmExportsAsRecorded)) !== EXPECTED.stableWasmExportSignature) {
		fail(
			"recorded-contract",
			"EXPECTED.wasmExportsAsRecorded does not reduce to EXPECTED.stableWasmExportSignature",
		);
	}

	const observedStable = stableExports(surface.wasmExports);
	const observedTrampolines = surface.wasmExports.filter((entry) =>
		TRAMPOLINE_EXPORT.test(entry.split("|")[0]),
	);
	const totalExpected = EXPECTED.stableWasmExportCount + EXPECTED.trampolineExportCount;
	if (surface.wasmExports.length !== totalExpected) {
		fail(
			"wasm-exports",
			`binary export count is ${surface.wasmExports.length}, not the recorded ${totalExpected}\n${exportDelta(surface.wasmExports)}`,
		);
	}
	// The 55 nameable exports stay an EXACT set — this is the contract a consumer relies on.
	if (
		observedStable.length !== EXPECTED.stableWasmExportCount ||
		signature(observedStable) !== EXPECTED.stableWasmExportSignature
	) {
		fail(
			"wasm-exports",
			`stably-named binary export set is not the exact recorded set of ${EXPECTED.stableWasmExportCount}\n${exportDelta(surface.wasmExports)}`,
		);
	}
	// The 3 compiler-generated trampolines are matched by shape and COUNT: their hashes vary by
	// build host (see TRAMPOLINE_EXPORT), their number does not. A 4th one, or a missing one, is a
	// real change to what the binary exports and still fails here.
	if (observedTrampolines.length !== EXPECTED.trampolineExportCount) {
		fail(
			"wasm-exports",
			`observed ${observedTrampolines.length} closure trampoline(s), recorded ${EXPECTED.trampolineExportCount}\n${exportDelta(surface.wasmExports)}`,
		);
	}
	for (const entry of observedTrampolines) {
		if (entry.split("|")[1] !== "function") {
			fail("wasm-exports", `trampoline ${entry} is not exported as a function`);
		}
	}
	if (
		surface.wasmImports.length !== 609 ||
		signature(surface.wasmImports) !== EXPECTED.wasmImportSignature
	) {
		fail(
			"wasm-imports",
			"binary import set moved from the exact C0 set of 609",
		);
	}

	// The two entries must expose the identical public set. Slicing the bundler entry's own block
	// is how `emitSyncEntry` builds it, so an inequality here means the emission drifted or the
	// generated file was hand-edited — either way one runtime would silently see a different API
	// from another, which no export-count assertion above would catch.
	const bundlerBlock = exportBlock(surface.wrapper);
	const syncBlock = exportBlock(surface.syncEntry);
	if (syncBlock === null) {
		fail("entry-parity", `${SYNC_ENTRY} carries no re-export block`);
	} else if (syncBlock !== bundlerBlock) {
		fail(
			"entry-parity",
			`${SYNC_ENTRY} re-exports a different set from ${BUNDLER_ENTRY}`,
		);
	}
	// An entry that re-exports the right names but never instantiates is the exact shape of the
	// original defect: it imports clean and dies on first call.
	for (const marker of ["__wbg_set_wasm(", "__wbindgen_start()"]) {
		if (!surface.syncEntry.includes(marker)) {
			fail("entry-parity", `${SYNC_ENTRY} never calls ${marker}`);
		}
	}

	// Condition ORDER is load-bearing: `types` must precede the runtime conditions and `default`
	// must come last, or a bundler resolves to the node entry (or a type resolver to a runtime
	// one). Comparing the serialised entries compares order and content in one assertion.
	const conditions = surface.wasmManifest.exports?.["."];
	const expectedConditions = EXPECTED.entryConditions;
	if (JSON.stringify(conditions) !== JSON.stringify(expectedConditions)) {
		fail(
			"entry-conditions",
			`the artifact's "." exports conditions are not the recorded ${Object.keys(expectedConditions).join("/")} routing`,
		);
	}
	// Without the wildcard subpath, adding `exports` would seal every deep path that resolved
	// before it existed — including the bundler entry the negative control imports by name.
	if (surface.wasmManifest.exports?.["./*"] !== "./*") {
		fail("entry-conditions", "the artifact's `./*` subpath passthrough is missing");
	}
	// The declared opt-in for runtimes that need explicit instantiation and are not bun. A deep
	// path would work through `./*`, but a *declared* subpath is what makes it a promise.
	if (
		surface.wasmManifest.exports?.[EXPECTED.syncSubpath] !== `./${SYNC_ENTRY}`
	) {
		fail(
			"entry-conditions",
			`the artifact's "${EXPECTED.syncSubpath}" subpath does not point at ${SYNC_ENTRY}`,
		);
	}
	// `node` must NOT be routed: bundlers targeting node set it and cannot serve this entry.
	if (surface.wasmManifest.exports?.["."]?.node !== undefined) {
		fail(
			"entry-conditions",
			"a `node` condition is declared; bundlers targeting node set it too and break on it (see BOUNDARIES §17)",
		);
	}

	const graphics = classBlock(surface.dts, "WasmRuntimeGraphicsQuery");
	for (const declaration of [
		'selectedBackend(): "webgl" | "webgpu" | null;',
		"concurrentCompositorInstances(): number;",
		"unavailableReason(): string;",
	]) {
		if (!graphics.includes(declaration)) {
			fail("graphics-provider", `missing exact declaration ${declaration}`);
		}
	}
	if (/\bany\b|\bboolean\b/.test(graphics)) {
		fail("graphics-provider", "provider contains any or a boolean substitute");
	}

	const gpu = classBlock(surface.dts, "WasmRuntimeGpuResourceQuery");
	for (const declaration of [
		"liveHandles(): readonly number[];",
		"release(input: { handle: number }): void;",
	]) {
		if (!gpu.includes(declaration)) {
			fail("gpu-provider", `missing exact declaration ${declaration}`);
		}
	}
	if (/\bany\b|\bboolean\b/.test(gpu)) {
		fail("gpu-provider", "provider contains any or a boolean substitute");
	}
	for (const declaration of [
		"initCompositor(width: number, height: number): void;",
		"resizeCompositor(width: number, height: number): void;",
		"getCompositorCanvas(): HTMLCanvasElement;",
		"uploadTexture(options: any): void;",
		"releaseTexture(id: string): void;",
		"renderFrame(options: any): void;",
	]) {
		if (!surface.dts.includes(declaration)) {
			fail(
				"legacy-compatibility",
				`legacy declaration changed: ${declaration}`,
			);
		}
	}

	const packageRegistered = aggregateCommands(surface.manifest).includes(
		`node ${API_GATE}`,
	);
	const installAt = workflowCommandPosition(surface.workflow, "bun install");
	const sourceAt = workflowCommandPosition(
		surface.workflow,
		"node script/check-wasm-source.mjs",
	);
	const pathsAt = workflowCommandPosition(
		surface.workflow,
		"node script/check-wasm-paths.mjs",
	);
	const workflowAt = workflowCommandPosition(
		surface.workflow,
		`node ${API_GATE}`,
	);
	const sourceRegistered = registeredSourceGates(surface.sourceGate).includes(
		API_GATE,
	);
	if (
		!packageRegistered ||
		installAt === -1 ||
		sourceAt <= installAt ||
		pathsAt <= sourceAt ||
		workflowAt <= pathsAt ||
		!sourceRegistered
	) {
		fail(
			"gate-registration",
			"API gate must be an exact check:wasm command, an exact GATED entry and the CI command after install/source/path checks",
		);
	}
	return errors;
}

function mutate(surface, control) {
	const copy = structuredClone(surface);
	if (control === "missing-export") copy.wrapperExports.pop();
	if (control === "extra-export") copy.wrapperExports.push("unexpectedExport");
	if (control === "changed-binary-import") copy.wasmImports.pop();
	if (control === "changed-binary-export") copy.wasmExports.pop();
	// --- the four controls guarding the trampoline re-scope (see TRAMPOLINE_EXPORT) ---
	if (control === "extra-trampoline") {
		copy.wasmExports.push(
			"wasm_bindgen__convert__closures_____invoke__h0123456789abcdef|function",
		);
	}
	if (control === "missing-trampoline") {
		const at = copy.wasmExports.findIndex((entry) =>
			TRAMPOLINE_EXPORT.test(entry.split("|")[0]),
		);
		copy.wasmExports.splice(at, 1);
	}
	if (control === "stable-export-disguised-as-trampoline") {
		// A real export renamed into the tolerated shape must NOT slip through the shape match.
		const at = copy.wasmExports.indexOf("snappedSeekTime|function");
		copy.wasmExports[at] =
			"wasm_bindgen__convert__closures_____invoke__hfedcba9876543210|function";
	}
	if (control === "edited-declaration") {
		// A non-trampoline declaration line edited: normalisation must not hide it.
		copy.wasmDts = copy.wasmDts.replace(
			"export const snappedSeekTime:",
			"export const snappedSeekTimeRenamed:",
		);
	}
	if (control === "trampoline-hash-swap") {
		// POSITIVE control: another build host's symbol hashes, in both the export table and the
		// declarations. This is exactly what CI observed; it must pass.
		const swaps = [
			["h6e68ca372e8bf468", "h276a4a183af50bac"],
			["h755062247edbbf0a", "h3a4584f6e44c7108"],
			["hf7fc07325ff431aa", "hc1daa042eeabb391"],
		];
		for (const [from, to] of swaps) {
			copy.wasmExports = copy.wasmExports.map((entry) => entry.replace(from, to));
			copy.wasmDts = copy.wasmDts.replaceAll(from, to);
		}
	}
	if (control === "invalid-backend") {
		copy.dts = copy.dts.replace(
			'"webgl" | "webgpu" | null',
			'"webgl" | "webgpu" | "software"',
		);
	}
	if (control === "boolean-count") {
		copy.dts = copy.dts.replace(
			"concurrentCompositorInstances(): number;",
			"concurrentCompositorInstances(): boolean;",
		);
	}
	if (control === "boolean-handles") {
		copy.dts = copy.dts.replace(
			"liveHandles(): readonly number[];",
			"liveHandles(): boolean;",
		);
	}
	if (control === "provider-any") {
		copy.dts = copy.dts.replace(
			"liveHandles(): readonly number[];",
			"liveHandles(): any;",
		);
	}
	if (control === "unkeyed-release") {
		copy.dts = copy.dts.replace(
			"release(input: { handle: number }): void;",
			"release(): void;",
		);
	}
	if (control === "truncated-files") copy.files.pop();
	if (control === "sync-entry-export-drift") {
		copy.syncEntry = copy.syncEntry.replace(
			"TICKS_PER_SECOND,",
			"TICKS_PER_SECOND, unexpectedExport,",
		);
	}
	if (control === "sync-entry-uninitialized") {
		copy.syncEntry = copy.syncEntry.replace(
			"instance.exports.__wbindgen_start();",
			"// start call removed",
		);
	}
	if (control === "condition-swap") {
		copy.wasmManifest.exports["."] = {
			types: "./opencut_wasm.d.ts",
			bun: `./${BUNDLER_ENTRY}`,
			default: `./${BUNDLER_ENTRY}`,
		};
	}
	if (control === "condition-dropped") {
		delete copy.wasmManifest.exports["./*"];
	}
	if (control === "sync-subpath-dropped") {
		delete copy.wasmManifest.exports[EXPECTED.syncSubpath];
	}
	if (control === "node-condition-added") {
		copy.wasmManifest.exports["."] = {
			types: "./opencut_wasm.d.ts",
			bun: `./${SYNC_ENTRY}`,
			node: `./${SYNC_ENTRY}`,
			default: `./${BUNDLER_ENTRY}`,
		};
	}
	if (control === "check-wasm-missing-registration") {
		copy.manifest.scripts["check:wasm"] = copy.manifest.scripts[
			"check:wasm"
		].replace(` && node ${API_GATE}`, "");
	}
	if (control === "check-wasm-decoy-registration") {
		copy.manifest.scripts["check:wasm"] = copy.manifest.scripts[
			"check:wasm"
		].replace(` && node ${API_GATE}`, "");
		copy.manifest.scripts.decoy = `node ${API_GATE}`;
	}
	if (control === "ci-missing-registration") {
		copy.workflow = copy.workflow.replace(
			`run: node ${API_GATE}`,
			"run: node script/missing-gate.mjs",
		);
	}
	if (control === "ci-before-install-registration") {
		copy.workflow = copy.workflow.replace(
			`run: node ${API_GATE}`,
			"run: node script/registration-swap-sentinel.mjs",
		);
		copy.workflow = copy.workflow.replace(
			"run: bun install",
			`run: node ${API_GATE}`,
		);
		copy.workflow = copy.workflow.replace(
			"run: node script/registration-swap-sentinel.mjs",
			"run: bun install",
		);
	}
	if (control === "gated-missing-registration") {
		copy.sourceGate = copy.sourceGate.replace(`\n\t"${API_GATE}",`, "");
	}
	return copy;
}

const fixture = process.argv.find((arg) =>
	arg.startsWith("--fixture-negative="),
);
if (fixture) {
	const control = fixture.split("=")[1];
	const errors = validate(mutate(loadSurface(), control));
	for (const error of errors) console.error(error);
	process.exit(errors.length === 0 ? 0 : 1);
}

if (process.argv.includes("--negative-control")) {
	for (const [control, expected] of Object.entries(CONTROLS)) {
		const result = spawnSync(
			process.execPath,
			[SELF, `--fixture-negative=${control}`],
			{
				encoding: "utf8",
			},
		);
		const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
		if (result.status !== 1 || !output.includes(`${expected}:`)) {
			console.error(`FAIL ${control}: did not exit 1 for ${expected}`);
			process.exit(1);
		}
		console.log(`PASS ${control} -> ${expected} (exit 1)`);
	}
	/**
	 * Positive controls close the other half. A re-scope that only proves "these mutations still
	 * fail" never demonstrates that the thing it deliberately permits IS permitted — so the next
	 * reader cannot distinguish an intended tolerance from a hole nobody noticed. These assert the
	 * tolerance directly, on the exact observation that motivated it.
	 */
	for (const [control, why] of Object.entries(POSITIVE_CONTROLS)) {
		const result = spawnSync(
			process.execPath,
			[SELF, `--fixture-negative=${control}`],
			{ encoding: "utf8" },
		);
		const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
		if (result.status !== 0) {
			console.error(`FAIL ${control}: expected exit 0, got ${result.status}\n${output}`);
			process.exit(1);
		}
		console.log(`PASS ${control} -> tolerated (exit 0): ${why}`);
	}
	process.exit(0);
}

if (!existsSync(PKG)) {
	console.error(
		"generated-files: rust/wasm/pkg is absent; run bun run build:wasm",
	);
	process.exit(2);
}
// Report a missing recorded file as a finding rather than a stack trace from `readFileSync`. A
// gate whose failure mode is an ENOENT dump is a gate whose output nobody reads.
const absent = EXPECTED.files.filter((name) => !existsSync(join(PKG, name)));
if (absent.length > 0) {
	for (const name of absent) {
		console.error(`generated-files: ${name} is absent from rust/wasm/pkg`);
	}
	console.error("Rebuild with: bun run build:wasm");
	process.exit(1);
}
const errors = validate(loadSurface());
if (errors.length > 0) {
	for (const error of errors) console.error(error);
	process.exit(1);
}
const compile = spawnSync(process.execPath, [
	join(ROOT, "script", "run-wasm-api-contract.mjs"),
]);
if (compile.status !== 0) {
	console.error("structural-compile: frozen runtime contracts do not compile");
	process.exit(1);
}
console.log(
	`check-wasm-api-surface: exact 38 JS exports, ${EXPECTED.stableWasmExportCount} stably-named binary exports + ${EXPECTED.trampolineExportCount} shape-matched compiler trampolines (${EXPECTED.stableWasmExportCount + EXPECTED.trampolineExportCount} total), 609 imports, ${Object.keys(EXPECTED.pinnedHashes).length} pinned files, ${EXPECTED.wasmDtsLineCount} declaration lines, both entries in parity over the recorded ${Object.keys(EXPECTED.entryConditions).length} exports conditions, providers and structural compile PASS`,
);

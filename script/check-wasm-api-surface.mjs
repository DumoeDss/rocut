#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
	API_GATE,
	BASELINE_DTS_SHA,
	CONTROLS,
	EXPECTED,
} from "./wasm-api-surface-contract.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PKG = join(ROOT, "rust", "wasm", "pkg");
const SELF = fileURLToPath(import.meta.url);

const sha = (value) => createHash("sha256").update(value).digest("hex");
const read = (path) => readFileSync(path);
const readText = (path) => readFileSync(path, "utf8");
const signature = (entries) => sha([...entries].sort().join("\n"));

function loadSurface() {
	const dts = readText(join(PKG, "opencut_wasm.d.ts"));
	const wrapper = readText(join(PKG, "opencut_wasm.js"));
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
		wasmDts,
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
		manifest: readText(join(ROOT, "package.json")),
		workflow: readText(join(ROOT, ".github", "workflows", "bun-ci.yml")),
		sourceGate: readText(join(ROOT, "script", "check-wasm-source.mjs")),
	};
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
	for (const [name, hash] of Object.entries(EXPECTED.unchangedHashes)) {
		if (surface.hashes[name] !== hash) {
			fail("generated-files", `${name} changed from the C0 before-state`);
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
	if (sha(surface.wasmDts) !== EXPECTED.wasmDtsSha) {
		fail(
			"binary-declarations",
			"low-level declarations differ from the recorded output",
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
	if (
		surface.wasmExports.length !== 58 ||
		signature(surface.wasmExports) !== EXPECTED.wasmExportSignature
	) {
		fail(
			"wasm-exports",
			"binary export set is not the exact recorded set of 58",
		);
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

	const packageAt = surface.manifest.indexOf(API_GATE);
	const installAt = surface.workflow.search(/run:\s*bun install/);
	const workflowAt = surface.workflow.indexOf(API_GATE);
	if (
		packageAt === -1 ||
		workflowAt < installAt ||
		!surface.sourceGate.includes(`"${API_GATE}"`)
	) {
		fail(
			"gate-registration",
			"API gate must be registered in GATED, check:wasm and CI",
		);
	}
	return errors;
}

function mutate(surface, control) {
	const copy = structuredClone(surface);
	if (control === "missing-export") copy.wrapperExports.pop();
	if (control === "extra-export") copy.wrapperExports.push("unexpectedExport");
	if (control === "changed-binary-import") copy.wasmImports.pop();
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
	if (control === "missing-registration") {
		copy.manifest = copy.manifest.replace(API_GATE, "script/missing-gate.mjs");
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
	process.exit(0);
}

if (!existsSync(PKG)) {
	console.error(
		"generated-files: rust/wasm/pkg is absent; run bun run build:wasm",
	);
	process.exit(2);
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
	"check-wasm-api-surface: exact 38 JS / 58 binary exports, 609 imports, providers and structural compile PASS",
);

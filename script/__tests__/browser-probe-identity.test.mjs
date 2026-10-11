import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, webcrypto } from "node:crypto";
import { resolveProbeBrowserExecutable, resolveRequiredProbeWasmBinding } from "../fixtures/browser-probe-identity.mjs";
import { createHtmlProbeWasmPlugin, HTML_PRIVATE_WASM_ID } from "../html-probe-wasm-binding.mjs";

async function fixture(run) {
	const directory = await mkdtemp(join(tmpdir(), "rocut-browser-identity-unit-"));
	try {
		const binary = Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0]);
		await writeFile(join(directory, "opencut_wasm_bg.wasm"), binary);
		await writeFile(join(directory, "opencut_wasm.js"), "export default async function init() {}\n");
		await writeFile(join(directory, "opencut_wasm.d.ts"), "export default function init(): Promise<void>;\n");
		await run({ directory, binary, expectedWasmSha256: createHash("sha256").update(binary).digest("hex") });
	} finally { await rm(directory, { recursive: true, force: true }); }
}

test("explicit browser resolves exactly; empty or missing explicit paths never fall back", async () => {
	await fixture(async ({ directory }) => {
		const executable = join(directory, "browser.exe");
		await writeFile(executable, Uint8Array.of(1));
		assert.equal(resolveProbeBrowserExecutable({ configured: executable, fallback: "must-not-be-consulted" }), realpathSync(executable));
		assert.throws(() => resolveProbeBrowserExecutable({ configured: "", fallback: executable }), /absolute/);
		assert.throws(() => resolveProbeBrowserExecutable({ configured: join(directory, "missing.exe"), fallback: executable }), /ENOENT/);
		assert.throws(() => resolveProbeBrowserExecutable({ configured: directory, fallback: executable }), /not a file/);
	});
});

test("required WASM identity rejects omission, empty values and wrong binary hash", async () => {
	await fixture(async ({ directory, expectedWasmSha256 }) => {
		for (const missing of [undefined, ""])
			assert.throws(() => resolveRequiredProbeWasmBinding({ directory: missing, expectedWasmSha256 }), /explicit/);
		assert.throws(() => resolveRequiredProbeWasmBinding({ directory, expectedWasmSha256: "" }), /nonempty/);
		assert.throws(() => resolveRequiredProbeWasmBinding({ directory, expectedWasmSha256: "f".repeat(64) }), /differs/);
		assert.equal(resolveRequiredProbeWasmBinding({ directory, expectedWasmSha256 }).identity.files.find((file) => file.name.endsWith(".wasm")).sha256, expectedWasmSha256);
	});
});

test("legacy bundler-only WASM is rejected rather than silently reused", async () => {
	await fixture(async ({ directory, expectedWasmSha256 }) => {
		await writeFile(join(directory, "opencut_wasm.js"), "import './opencut_wasm_bg.wasm'; export function legacy() {}\n");
		assert.throws(() => resolveRequiredProbeWasmBinding({ directory, expectedWasmSha256 }), /asynchronous web/);
	});
});

test("shared private plugin hashes fetched bytes before awaited init and identity stamping", async () => {
	await fixture(async ({ directory, binary, expectedWasmSha256 }) => {
		const binding = resolveRequiredProbeWasmBinding({ directory, expectedWasmSha256 });
		const plugin = createHtmlProbeWasmPlugin(binding);
		const source = plugin.load(plugin.resolveId(HTML_PRIVATE_WASM_ID));
		const executable = source.replace(/^import init from .*;\n/m, "").replace(/^import wasmUrl from .*;\n/m, "").replace(/^export \* from .*;$/m, "");
		const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
		const run = new AsyncFunction("init", "wasmUrl", "fetch", "crypto", "globalThis", executable);
		let initialized = 0;
		const init = async ({ module_or_path }) => { await WebAssembly.compile(module_or_path); initialized++; };
		const wrongGlobal = {};
		await assert.rejects(run(init, "/binary.wasm", async () => new Response(Uint8Array.of(99)), webcrypto, wrongGlobal), /differs/);
		assert.equal(initialized, 0);
		assert.equal(wrongGlobal.__htmlProbeWasmIdentity, undefined);
		const correctGlobal = {};
		await run(init, "/binary.wasm", async () => new Response(binary), webcrypto, correctGlobal);
		assert.equal(initialized, 1);
		assert.deepEqual(correctGlobal.__htmlProbeWasmIdentity, binding.identity);
	});
});

test("audio and video plumbing retain bound launch, real preload, plugin and two-sided evidence", async () => {
	const source = async (path) => new TextDecoder("utf-8", { fatal: true }).decode(await readFile(new URL(`../${path}`, import.meta.url)));
	for (const path of ["probe-remotion-audio.mjs", "probe-hyperframes-audio-editor.mjs"]) {
		const text = await source(path);
		assert.match(text, /resolveProbeBrowserExecutable\(/);
		assert.match(text, /local-wasm-preload\.mjs/);
		assert.match(text, /executablePath[, }]/);
		assert.match(text, /assertHtmlProbeWasmIdentity\(binding, browserWasmIdentity\)/);
		assert.match(text, /assertHtmlProbeWasmIdentity\(binding, hostWasmIdentity\)/);
		assert.match(text, /saveHtmlProbeEvidence\(/);
	}
	const builder = await source("native-audio-export-build.mjs");
	assert.match(builder, /createHtmlProbeWasmPlugin\(binding\)/);
	assert.match(builder, /"opencut-wasm": HTML_PRIVATE_WASM_ID/);
	assert.doesNotMatch(builder, /return this\.resolve\(entry/);
	for (const path of ["fixtures/native-video-fixture.mjs", "fixtures/hyperframes-audio-editor-host.ts", "fixtures/remotion-audio-pcm-diagnostic.ts"])
		assert.match(await source(path), /configured: process\.env\.ROCUT_PROBE_BROWSER_PATH/);
});

import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { nightInputs, nightActual, nightHash } from "./fixtures/mv-night-native-input.mjs";
const flags = process.argv.slice(2);
const stage = flags.find(f => ["--cpu-only", "--browser-only"].includes(f));
assert.ok(stage && flags.filter(f => ["--cpu-only", "--browser-only"].includes(f)).length === 1 && flags.every(f => ["--cpu-only", "--browser-only", "--dedicated-native-fixtures"].includes(f)) && new Set(flags).size === flags.length, "Explicit CPU/browser gate; optional explicit dedicated native fixture flag required");
const mode = flags.includes("--dedicated-native-fixtures") ? "dedicated-native-fixtures" : "actual-project-assets";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const directory = process.env.ROCUT_TEST_NIGHT_TEMP;
assert.ok(directory && isAbsolute(directory) && directory.replaceAll("\\", "/").startsWith("E:/Elftia-private-tests/"), "All outputs require explicit private E: ROCUT_TEST_NIGHT_TEMP");
process.env.TEMP = directory; process.env.TMP = directory;
const data = await nightInputs({ root, referenceRoot: process.env.ROCUT_TEST_MV_REFERENCE, mode, projectRoot: process.env.ROCUT_TEST_MV_PROJECT, mincho700: process.env.ROCUT_TEST_MV_MINCHO700 });
if (stage === "--cpu-only") {
    console.log(JSON.stringify({ mode, stage: "actual original sources/font/LUT byte inventory only", browserExecuted: false, wasmExecuted: false, nativeAcceptancePassed: false,
        references: [...data.references, data.main, data.gl].map(({ id, sha256 }) => ({ id, sha256 })), physicalFontResources: data.fonts.map(f => f.resource), fontInstances: data.fontInstances, images: data.images.map(i => i.resource), lutResources: data.lut.metadata.resources,
        scope: "Byte inventory only; dedicated images are NOT generated until explicit native browser mode; no SFNT/native decode/pixel/full movie/export acceptance" }, null, 2)); process.exit(0);
}
const isolated = process.env.ROCUT_TEST_WASM_DIRECTORY, browserExecutable = process.env.ROCUT_TEST_BROWSER_EXECUTABLE, rustSource = process.env.ROCUT_TEST_RUST_SOURCE;
assert.ok([isolated, browserExecutable, rustSource].every(p => p && isAbsolute(p)), "Explicit private WASM/browser/compiled source checkpoint paths required");
const nodePaths = ["script/probe-mv-night-native.mjs", "script/browser-probe-toolchain.mjs", "script/fixtures/mv-night-native-input.mjs", "script/fixtures/mv-night-native-build.mjs", "script/fixtures/mv-night-native-identities.mjs", "script/fixtures/mv-lut-atlas-native-identities.mjs", "script/fixtures/mv-fall-evidence.mjs"];
const nodeSources = await Promise.all(nodePaths.map(async path => ({ path, sha256: nightHash(await nightActual(join(root, path))) })));
const [{ chromium, createServer }, { buildNightNative }, { nightCompiledCheckpoint }, { fallWasmIdentity, fallServedIdentity }] = await Promise.all([import("./browser-probe-toolchain.mjs"), import("./fixtures/mv-night-native-build.mjs"), import("./fixtures/mv-night-native-identities.mjs"), import("./fixtures/mv-fall-evidence.mjs")]);
const wasmIdentity = await fallWasmIdentity(isolated);
// Frozen-source identity reads normally use the live worktree. While another
// workstream holds uncommitted Rust edits (e.g. import reordering without
// semantic change), ROCUT_TEST_IDENTITY_ROOT can point identity reads at the
// checkpoint source snapshot so the compiled-input freeze stays meaningful.
const identityRoot = process.env.ROCUT_TEST_IDENTITY_ROOT || root;
const rustOptions = { root: identityRoot, directory: rustSource, manifestSha256: wasmIdentity.sourceManifestSha256 };
const rustIdentity = await nightCompiledCheckpoint(rustOptions);
const glue = await readFile(join(isolated, "opencut_wasm.js"), "utf8");
const owner = glue.match(/export class MvNightOwner[\s\S]*?(?=\nexport class |\nexport function |$)/);
assert.ok(owner, "Fresh actual compiled Night WASM export missing"); assert.doesNotMatch(owner[0], /passArray8ToWasm/, "Generated Night owner bypasses native pre-copy checks");
const browserIdentity = { sha256: nightHash(await readFile(browserExecutable)) };
const artifact = await mkdtemp(join(directory, "rocut-night-native-")), web = join(artifact, "web");
let server, browser;
try {
    const sources = await buildNightNative({ root, isolated, output: web });
    const servedIdentity = await fallServedIdentity(web);
    server = await createServer({ root: web, configFile: false, logLevel: "error", cacheDir: join(artifact, "vite-cache"), optimizeDeps: { noDiscovery: true, include: [] }, server: { host: "127.0.0.1", port: 0, hmr: false } });
    await server.listen();
    const origin = "http://127.0.0.1:" + server.httpServer.address().port;
    browser = await chromium.launch({ headless: true, executablePath: browserExecutable, args: ["--disable-gpu-rasterization"] });
    const page = await browser.newPage(), errors = [], external = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.route("**/*", route => { const url = new URL(route.request().url()); if (/^https?:$/.test(url.protocol) && url.origin !== origin) { external.push(url.origin); return route.abort(); } return route.continue(); });
    await page.addInitScript(input => { globalThis.__nightInput = input; }, data);
    await page.goto(origin + "/script/fixtures/mv-night-native-browser.html", { waitUntil: "commit" });
    await page.waitForFunction(() => globalThis.__nightResult !== undefined, undefined, { timeout: 180000 });
    const result = await page.evaluate(() => globalThis.__nightResult);
    assert.equal(errors.length, 0, errors.join("\n")); assert.equal(external.length, 0, external.join("\n"));
    const evidence = { result, wasmIdentity, rustIdentity, browserIdentity, servedIdentity, sources, nodeSources, browserExecuted: true,
        references: [...data.references, data.main, data.gl].map(({ id, sha256 }) => ({ id, sha256 })), scope: result.scope };
    // Persist evidence even when a later assertion fails so parity diagnostics remain inspectable.
    await writeFile(join(artifact, "evidence.json"), JSON.stringify(evidence, null, 2), "utf8");
    assert.equal(result.status, "passed", result.error); assert.equal(result.mode, mode); assert.equal(result.cases.length, 5); assert.equal(result.lutMaxChannelError, 0); assert.ok(result.negativeCount >= 25);
    for (const item of result.cases) { assert.ok(item.maxChannelError <= 1); if (item.name.startsWith("train-")) { assert.equal(item.postGatePassed, true); assert.equal(item.postPasses, 15); } }
    assert.deepEqual(await fallWasmIdentity(isolated), wasmIdentity, "WASM changed during gate"); assert.deepEqual(await nightCompiledCheckpoint(rustOptions), rustIdentity, "Frozen snapshot/current leaves changed"); assert.deepEqual(await fallServedIdentity(web), servedIdentity, "Served bundle changed");
    for (const { path, sha256 } of [...sources, ...nodeSources]) assert.equal(nightHash(await nightActual(join(root, path))), sha256, "Loaded launcher/frontend source changed: " + path);
    console.log(JSON.stringify({ artifact, ...evidence }, null, 2));
} finally { if (browser) await browser.close(); if (server) await server.close(); }

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
const source = new TextDecoder("utf-8", { fatal: true }).decode(await readFile(new URL("../check-wasm-init.mjs", import.meta.url)));
const body = source.slice(source.indexOf("function runProbe("), source.indexOf("\nif (!existsSync"));
function harness(platform = "win32", result = { status: 0, signal: null, stdout: '{"ok":true}\n', stderr: "" }, realSpawn) {
    const failures = [], calls = [];
    const run = new Function("spawnSync", "process", "ROOT", "PROBE_TIMEOUT_MS", "quoteIfNeeded", "fail", "console",
        `${body}; return runProbe;`)((...args) => { calls.push(args); return realSpawn ? realSpawn(...args) : result; },
        { platform }, "private-root", realSpawn ? 75 : 30000, (part) => /\s/.test(part) ? `"${part}"` : part,
        (failure) => failures.push(failure), { log() {} });
    return { run, calls, failures };
}
test("Windows native exe/node launches directly with separate arguments, hidden window and bound", () => {
    for (const executable of ["C:/Program Files/Bun/bun.exe", "C:/nvm/node.exe", "bun", "node", "npx.exe"]) {
        const h = harness(); assert.deepEqual(h.run({ label: "native", command: [executable], args: ["probe path.mjs", "--specifier=opencut-wasm"] }), { ok: true });
        const [command, args, options] = h.calls[0]; assert.equal(command, executable); assert.deepEqual(args, ["probe path.mjs", "--specifier=opencut-wasm"]);
        assert.equal(options.shell, false); assert.equal(options.windowsHide, true); assert.equal(options.timeout, 30000); assert.deepEqual(options.stdio, ["ignore", "pipe", "pipe"]);
    }
});
test("only actual Windows batch/npx shims use shell; POSIX npx does not", () => {
    for (const executable of ["npx", "C:/tools/npx", "bun.cmd", "C:/tools/BUN.CMD", "probe.bat"]) {
        const h = harness(); h.run({ label: "shim", command: [executable], args: ["probe path.mjs"] });
        assert.equal(h.calls[0].length, 2); assert.equal(h.calls[0][1].shell, true); assert.equal(h.calls[0][1].timeout, 30000);
    }
    const h = harness("linux"); h.run({ label: "posix", command: ["npx"], args: [] }); assert.equal(h.calls[0][2].shell, false);
});
test("timeout/crash/spawn failure cannot accept partial valid or expected-negative JSON", () => {
    for (const result of [{ error: { code: "ETIMEDOUT" }, status: null }, { error: { code: "ENOENT" }, status: null }, { status: 1 }, { status: null, signal: "SIGTERM" }]) {
        for (const stdout of ['{"ok":true}', '{"error":"wasm.__wbindgen_start is not a function"}']) {
            const h = harness("win32", { ...result, stdout, stderr: "" }); assert.equal(h.run({ label: "negative", command: ["bun.exe"], args: [] }), null); assert.equal(h.failures.length, 1);
        }
    }
});
test("clean exit preserves original JSON report and no-report still fails", () => {
    const valid = { runtime: "bun", error: "wasm.__wbindgen_start is not a function" };
    const h = harness("win32", { status: 0, stdout: `chatter\n${JSON.stringify(valid)}\n`, stderr: "" }); assert.deepEqual(h.run({ label: "control", command: ["bun.exe"], args: [] }), valid); assert.deepEqual(h.failures, []);
    const bad = harness("win32", { status: 0, stdout: "no report", stderr: "" }); assert.equal(bad.run({ label: "empty", command: ["bun.exe"], args: [] }), null); assert.equal(bad.failures.length, 1);
});
test("real owned CPU child times out even after printing valid JSON", () => {
    const h = harness(process.platform, null, (...args) => { const options = args.at(-1); options.cwd = process.cwd(); return spawnSync(...args); });
    assert.equal(h.run({ label: "owned-timeout", command: [process.execPath], args: ["-e", 'console.log(JSON.stringify({ok:true}));setInterval(()=>{},1000)'] }), null);
    assert.match(h.failures[0], /ETIMEDOUT/);
});

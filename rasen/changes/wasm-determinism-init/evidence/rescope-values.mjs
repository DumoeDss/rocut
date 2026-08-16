import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const sha = (value) => createHash("sha256").update(value).digest("hex");
const signature = (entries) => sha([...entries].sort().join("\n"));

const TRAMPOLINE = /^wasm_bindgen__convert__closures_____invoke__h[0-9a-f]{16}$/;

const m = new WebAssembly.Module(readFileSync("rust/wasm/pkg/opencut_wasm_bg.wasm"));
const exports = WebAssembly.Module.exports(m).map((e) => `${e.name}|${e.kind}`);
const stable = exports.filter((e) => !TRAMPOLINE.test(e.split("|")[0]));
const tramps = exports.filter((e) => TRAMPOLINE.test(e.split("|")[0]));

console.log("total exports          :", exports.length);
console.log("stable exports         :", stable.length);
console.log("trampolines            :", tramps.length);
console.log("stableWasmExportSignature:", signature(stable));

const dts = readFileSync("rust/wasm/pkg/opencut_wasm_bg.wasm.d.ts", "utf8");
const normalizedLines = dts
	.split(/\r?\n/)
	.map((line) =>
		line.replace(/(wasm_bindgen__convert__closures_____invoke__h)[0-9a-f]{16}/g, "$1<hash>"),
	)
	.filter((line) => line.trim().length > 0);
console.log("d.ts non-empty lines   :", normalizedLines.length);
console.log("wasmDtsNormalizedSignature:", signature(normalizedLines));

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const getter = "__wbg_gpu_3f9d7df9a18237f8";
const moduleName = "./opencut_wasm_bg.js";
const coreHash = "1b6671bdecfe6d6ad488a4bdf4583dc4d06a81229e2ce0aeffd274660c27a9f2";
const glueHash = "9873e13811deaaf1b64e8b9c60f5ab46849da80f3ca4a674cbee5973f35dc0f7";
const exactGetter = `export function ${getter}(arg0) {\n    const ret = arg0.gpu;\n    return ret;\n}`;

/** Hash-pinned ABI: the unchanged JS getter takes one JS reference and returns its gpu property. */
function verifyCapabilityPayload(core, glue) {
  const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
  assert.equal(hash(core), coreHash, "Capability core ABI pin mismatch");
  assert.equal(hash(glue), glueHash, "Capability glue ABI pin mismatch");
  const source = new TextDecoder("utf-8", { fatal: true }).decode(glue).replaceAll("\r\n", "\n");
  assert.equal(source.split(exactGetter).length - 1, 1, "Exact getter signature/body required once");
  const imports = WebAssembly.Module.imports(new WebAssembly.Module(core));
  const matched = imports.filter(x => x.name.startsWith("__wbg_gpu_"));
  assert.equal(matched.length, 1, "Single GPU capability import required");
  assert.deepEqual(matched[0], { module: moduleName, name: getter, kind: "function" });
  return { semantics: "fallback-capability-limited", module: moduleName, getter, signature: "(arg0 JS reference) => JS reference/undefined", coreHash, glueHash };
}

/** Serialized into only the new fixture page; does not change navigator or module exports. */
function limitedImports(imports, glue, policy) {
  const matched = imports.filter(x => x.name.startsWith("__wbg_gpu_"));
  if (matched.length !== 1 || matched[0].module !== "./opencut_wasm_bg.js" || matched[0].name !== "__wbg_gpu_3f9d7df9a18237f8" || matched[0].kind !== "function") throw Error("Capability import mismatch");
  const original = glue[matched[0].name];
  if (typeof original !== "function" || original.length !== 1) throw Error("Capability getter signature mismatch");
  const table = Object.fromEntries([...new Set(imports.map(x => x.module))].map(name => [name, { ...glue }]));
  table[matched[0].module][matched[0].name] = function (navigatorReference) { void navigatorReference; policy.getterCalls++; return undefined; };
  return table;
}
module.exports = { verifyCapabilityPayload, limitedImports };

import {mock} from "bun:test";
import {resolve,join} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";

/** Bind real private generated exports before the Host's transitive modules
 * link. Bun's runtime plugin alone does not replace cached package resolution. */
export async function bindRemotionProducedFunctionalWasm(directory:string) {
  const entry=join(resolve(directory),"opencut_wasm_sync.js");
  const actual=await import(pathToFileURL(entry).href);
  for(const name of ["resolveStylizedEffectJson","resolveRemotionProducedFramesJson","resolveRemotionProducedAssetsJson",
    "prepareRemotionInlineAudioSourcesJson","mixRemotionProducedAudioPcm","encodeRemotionProducedAudioWav"])
    if(typeof actual[name]!=="function")throw Error("Missing real private WASM export "+name);
  mock.module("opencut-wasm",()=>actual);
  mock.module("opencut-wasm/sync",()=>actual);
  // Observed Host import owners: root, CLI, and editor-classic. Bind their
  // actual Bun-resolved entries, not a broad filename regex or synthetic ABI.
  for(const owner of ["../../","../../apps/cli/","../../packages/editor-classic/"]) {
    const base=fileURLToPath(new URL(owner,import.meta.url));
    for(const specifier of ["opencut-wasm","opencut-wasm/sync"]) {
      const resolved=Bun.resolveSync(specifier,base);
      mock.module(resolved,()=>actual);
      mock.module(pathToFileURL(resolved).href,()=>actual);
    }
  }
  return actual;
}

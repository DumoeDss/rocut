import assert from "node:assert/strict";
import { mock } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// The official bundler artifact's generated sync entry instantiates its own
// exact binary. No initSync/web-target assumption, API stubs or shared copies.
const directory=process.env.ROCUT_TEST_WASM_DIRECTORY;
assert.ok(directory && /^[cC]:[\\/]/.test(directory),"Private C WASM directory is required");
const actual=await import(pathToFileURL(join(directory,"opencut_wasm_sync.js")).href);
for(const name of ["resolveHyperframesAudioDiscoveryJson","resolveHyperframesAudioSeekJson",
 "resolveHyperframesAudioObservationsJson","resolveHyperframesAudioExecutionPlanJson","prepareHyperframesAudioDryTrackPcm"])
 assert.equal(typeof actual[name],"function",`Missing real WASM export ${name}`);
mock.module("opencut-wasm",()=>actual);
for(const owner of ["","packages/editor-classic/","packages/editor-contracts/","apps/vite-example/","apps/cli/"]){
 const entry=fileURLToPath(new URL(`../../${owner}node_modules/opencut-wasm/opencut_wasm_sync.js`,import.meta.url));
 if(existsSync(entry))mock.module(entry,()=>actual);
}

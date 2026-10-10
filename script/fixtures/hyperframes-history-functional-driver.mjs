import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdtemp, writeFile, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Locked local provenance. Default mode is read-only preparation, not execution.
const paths={
 wasm:"C:/Users/Sayo/AppData/Local/Temp/rocut-agile-integration-6b1a8d423f32/wasm",
 toolchain:"C:/Users/Sayo/AppData/Local/Temp/rocut-media-toolchain-YbloF9",
 archive:"C:/Users/Sayo/AppData/Local/Temp/rocut-hf-engine-inspect-67d1b402/hyperframes-engine-0.8.139.tgz",
 chromium:"C:/Program Files/Google/Chrome/Application/chrome.exe",
 ffmpeg:"E:/Software/ffmpeg-6.0-full_build/bin/ffmpeg.exe",
 ffprobe:"E:/Software/ffmpeg-6.0-full_build/bin/ffprobe.exe",
};
const wasmSha256="e5835503cc9959654b1d50db785b5d57d1489f55694b2b7093aa74387b418c7f";
assert.ok(process.argv.slice(2).every(value=>value==="--execute"),"Only --execute is accepted");
const digest=bytes=>createHash("sha256").update(bytes).digest("hex");
const actualWasm=digest(await readFile(join(paths.wasm,"opencut_wasm_bg.wasm")));
assert.equal(actualWasm,wasmSha256,"Private WASM identity changed; review before execution");
for(const path of [paths.archive,paths.chromium,paths.ffmpeg,paths.ffprobe])assert.ok((await stat(path)).isFile());
const versions={};
for(const [name,version] of [["@hyperframes/core","0.8.139"],["acorn","8.19.0"],["gsap","3.15.0"],["esbuild","0.27.3"]]){
 const metadata=JSON.parse(await readFile(join(paths.toolchain,`node_modules/${name}/package.json`),"utf8"));
 assert.equal(metadata.version,version);versions[name]=metadata.version;
}
const identity={paths,wasmSha256,versions,packageLockSha256:digest(await readFile(join(paths.toolchain,"package-lock.json"))),
 archiveSha256:digest(await readFile(paths.archive)),state:"prepared-not-executed"};
assert.equal(identity.packageLockSha256,"ab0ed9cd8e1c2eaa220540bcb874ebf658f1d4b4682ae6809d173cfd1838579b","Pinned toolchain lock changed");
assert.equal(identity.archiveSha256,"228c687ab43048eb74bcdd5d8af4319e8f4707da689532159b8ac14dacb1c6e7","Original engine archive changed");
if(!process.argv.includes("--execute")){console.log(JSON.stringify(identity,null,2));}
else{
 const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
 const directory=await mkdtemp("C:/Users/Sayo/AppData/Local/Temp/rocut-hf-history-functional-");
 await writeFile(join(directory,"provenance.json"),JSON.stringify(identity,null,2),{flag:"wx"});
 console.log(JSON.stringify({directory,state:"executing-functional-only"}));
 const child=spawn("bun",["--preload","./script/fixtures/hyperframes-history-functional-preload.mjs","script/fixtures/hyperframes-history-functional-run.ts"],{
  cwd:root,windowsHide:true,stdio:"inherit",env:{...process.env,
   TEMP:directory,TMP:directory,TMPDIR:directory,ROCUT_HISTORY_FUNCTIONAL_DIRECTORY:directory,
   ROCUT_TEST_WASM_DIRECTORY:paths.wasm,ROCUT_TEST_HYPERFRAMES_TOOLCHAIN:paths.toolchain,
   ROCUT_HTML_BROWSER_PATH:paths.chromium,ROCUT_TEST_FFMPEG:paths.ffmpeg,ROCUT_TEST_FFPROBE:paths.ffprobe}});
 process.exitCode=await new Promise((done,reject)=>{child.once("error",reject);child.once("close",code=>done(code??1));});
}

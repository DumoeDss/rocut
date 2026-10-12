import assert from "node:assert/strict";
import { mkdir, copyFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { resolveGlassObjectParamsJson, resolveInkObjectParamsJson } from "opencut-wasm";
import { FileProjectStore } from "../../apps/cli/src/file-store";
import { importProgrammaticResource } from "../../apps/cli/src/programmatic/resource-import";
import { loadProgrammaticResources } from "../../apps/cli/src/programmatic/resources";
import { compileProgrammaticProject } from "../../apps/cli/src/programmatic/engines/compile-project";

export async function run({root, workspace}: {root:string; workspace:string}) {
 const creator = "E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/elftia/elftia-plugin-creator-studio/resources/agent/skills/html-video/assets/rocut-stylized";
 const current = "C:/tmps/rocut-three-pinned-features-ZvqmB9/toolchain";
 const asset = "C:/tmps/rocut-three-pinned-features-ZvqmB9/animated.glb";
 const bytes = await readFile(asset);
 const jsonLength = bytes.readUInt32LE(12);
 assert.equal(JSON.parse(bytes.subarray(20,20+jsonLength).toString("utf8")).animations[0].name,"move");
 const {glassObjectThree} = await import(pathToFileURL(join(creator,"glass-object.mjs")).href);
 const {inkObjectThree} = await import(pathToFileURL(join(creator,"ink-object.mjs")).href);
 const results = [];
 for (const animated of [true,false]) for (const kind of ["glass","ink"]) {
  const id = `${kind}-${animated ? "animated" : "legacy-default"}`;
  const directory = join(root,id); await mkdir(directory);
  const author = join(directory,"author"); await mkdir(author);
  const entry = `${kind}-object-scene.ts`; await copyFile(join(creator,entry),join(author,entry));
  const context = {store:new FileProjectStore({root:join(directory,"project"),schemaVersion:1}),projectId:id as never};
  const model = (await importProgrammaticResource({...context,input:{id:"assets/animated.glb",kind:"model",mimeType:"model/gltf-binary",filePath:asset}})).resource;
  const helper = kind === "glass" ? glassObjectThree : inkObjectThree;
  const value = await helper({sourceDirectory:author,model,settings:{width:320,height:180,durationFrames:60},inputProps:animated ? {animation:{clip:"move",mode:"clamp",speed:1,offset:0}} : {},resolveParams:kind === "glass" ? resolveGlassObjectParamsJson : resolveInkObjectParamsJson});
  const toolchain = animated ? current : join(workspace,".artifacts/three-toolchain/run-3Hn5Nw");
  try {
   const result = await compileProgrammaticProject({action:"compile",input:value.spec,toolchainDirectory:toolchain,context,signal:AbortSignal.timeout(30000),enqueue:async task=>task()});
   const source = result.source;
   assert.deepEqual(source.build!.inputs.map(input=>input.id),value.spec.files);
   const archived = await loadProgrammaticResources(context,[...source.build!.inputs,source.build!.toolchainLock,...source.resources!],new AbortController().signal);
   const document = archived.find(input=>input.resource.id===source.documentId)!;
   assert(document.body.byteLength>100000);
   assert.deepEqual(Buffer.from(archived.find(input=>input.resource.id===entry)!.body),await readFile(join(author,entry)));
   assert.deepEqual(source.build!.inputProps.animation,animated ? {clip:"move",mode:"clamp",speed:1,offset:0} : undefined);
   await writeFile(join(directory,"source.json"),JSON.stringify(source,null,2),{flag:"wx"});
   await writeFile(join(directory,"compiled.html"),Buffer.from(document.body),{flag:"wx"});
   results.push({id,ok:true,toolchain,compiledBytes:document.body.byteLength,archiveReadback:true,animation:source.build!.inputProps.animation ?? null});
  } catch(error) {results.push({id,ok:false,toolchain,error:String(error)}); if(animated) {await writeFile(join(root,"failure.json"),JSON.stringify(results,null,2),{flag:"wx"}); throw error;}}
 }
 await writeFile(join(root,"receipt.json"),JSON.stringify({ok:results.filter(item=>item.id.endsWith("animated")).every(item=>item.ok),results,asset,assetSha256:createHash("sha256").update(bytes).digest("hex"),scope:"real Rust resolvers/imported GLB/full compileProgrammaticProject/archive readback; no GPU, render, encoding, or runtime animation sampling"},null,2),{flag:"wx"});
}

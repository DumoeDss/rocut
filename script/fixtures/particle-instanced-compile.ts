import assert from "node:assert/strict";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { startHost } from "../../apps/cli/src/host";
import { TargetRegistry } from "../../apps/cli/src/target-registry";
import { FileProjectStore } from "../../apps/cli/src/file-store";
import { importProgrammaticResource } from "../../apps/cli/src/programmatic/resource-import";
import { compileProgrammaticProject } from "../../apps/cli/src/programmatic/engines/compile-project";
import { loadProgrammaticResources } from "../../apps/cli/src/programmatic/resources";

function staticGlb() {
  const bin = Buffer.alloc(36);
  [0,0,0, 1,0,0, 0,1,0].forEach((v,i) => bin.writeFloatLE(v,i*4));
  const data = { asset:{version:"2.0"}, scene:0, scenes:[{nodes:[0]}], nodes:[{mesh:0}],
    meshes:[{primitives:[{attributes:{POSITION:0},material:0}]}], materials:[{pbrMetallicRoughness:{baseColorFactor:[1,.3,.1,1]}}],
    buffers:[{byteLength:36}], bufferViews:[{buffer:0,byteOffset:0,byteLength:36}],
    accessors:[{bufferView:0,componentType:5126,count:3,type:"VEC3",min:[0,0,0],max:[1,1,0]}] };
  const text = Buffer.from(JSON.stringify(data)), json = Buffer.alloc(Math.ceil(text.length/4)*4,32); text.copy(json);
  const bytes = Buffer.alloc(12+8+json.length+8+bin.length);
  bytes.writeUInt32LE(0x46546c67,0);bytes.writeUInt32LE(2,4);bytes.writeUInt32LE(bytes.length,8);
  bytes.writeUInt32LE(json.length,12);bytes.writeUInt32LE(0x4e4f534a,16);json.copy(bytes,20);
  bytes.writeUInt32LE(bin.length,20+json.length);bytes.writeUInt32LE(0x004e4942,24+json.length);bin.copy(bytes,28+json.length);
  return bytes;
}
export async function runParticleInstancedCompile({root,toolchain,creator}) {
  const projectRoot=join(root,"project"),author=join(root,"author"); await mkdir(author);
  const host=await startHost({projectRoot,registry:new TargetRegistry(join(root,"registry")),htmlBrowserExecutable:"",htmlFrameConnectionFile:""});
  let receipt;
  try {
    const response=await fetch(new URL("api/context",host.editorUrl)); assert.equal(response.status,200);
    const info=await response.json(),context={store:new FileProjectStore({root:projectRoot,schemaVersion:1}),projectId:info.project.id};
    const bytes=staticGlb(),filePath=join(root,"static.glb");await writeFile(filePath,bytes,{flag:"wx"});
    const resource=(await importProgrammaticResource({...context,input:{id:"assets/static.glb",kind:"model",mimeType:"model/gltf-binary",filePath}})).resource;
    const {particleInstancedThree}=await import(pathToFileURL(join(creator,"particle-instanced-object.mjs")).href);
    const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],mirror=[-1,0,0,0,0,1,0,0,0,0,1,0,3,0,0,1];
    const value=particleInstancedThree({sourceDirectory:author,model:resource,instances:[identity,mirror],settings:{width:64,height:64,durationFrames:1,frameRate:{numerator:30,denominator:1},seed:19},inputProps:{count:32}});
    for(const file of value.spec.files)await copyFile(join(creator,file),join(author,file));
    const compile=(action,input)=>compileProgrammaticProject({action,input,toolchainDirectory:toolchain,context,signal:AbortSignal.timeout(30000),enqueue:async task=>task()});
    const result=await compile("compile",value.spec),source=result.source;
    assert.deepEqual(source.build.capabilities,["particle-surface-v1"]);assert.deepEqual(source.build.inputProps,value.spec.inputProps);
    assert.deepEqual(source.build.inputs.map(x=>x.id).sort(),[...value.spec.files].sort());
    const archived=await loadProgrammaticResources(context,[...source.build.inputs,source.build.toolchainLock,...source.resources],new AbortController().signal);
    for(const input of source.build.inputs)assert.deepEqual(Buffer.from(archived.find(x=>x.resource.id===input.id).body),await readFile(join(author,input.id)));
    assert.deepEqual(Buffer.from(archived.find(x=>x.resource.id===resource.id).body),bytes);
    const document=archived.find(x=>x.resource.id===source.documentId);assert(document.body.byteLength>100000);
    await rename(author,join(root,"author-unavailable"));await rename(filePath,join(root,"original-unavailable.glb"));
    const rebuilt=await compile("rebuild",source);assert.deepEqual(rebuilt.source,source);assert.equal(rebuilt.reusedDocument,true);
    await writeFile(join(root,"source.json"),JSON.stringify(source,null,2),{flag:"wx"});
    receipt={ok:true,root,toolchain,creator,resource,authorFiles:value.spec.files,compiledBytes:document.body.byteLength,archiveBytesVerified:true,archiveOnlyRebuild:true,scope:"real static GLB import/Creator helper/formal compile/exact author+GLB archive readback/archive-only rebuild; no author execution/GPU/browser/WASM/Vite/pack"};
  } finally {await host.close();await writeFile(join(root,"cleanup.json"),JSON.stringify({hostClosed:true}),{flag:"wx"});}
  await writeFile(join(root,"receipt.json"),JSON.stringify(receipt,null,2),{flag:"wx"});return receipt;
}

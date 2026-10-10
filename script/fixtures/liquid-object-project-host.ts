import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { startHost, type RunningHost } from "../../apps/cli/src/host";
import { TargetRegistry } from "../../apps/cli/src/target-registry";
import { FileProjectStore } from "../../apps/cli/src/file-store";
import { loadProgrammaticResource } from "../../apps/cli/src/programmatic/resources";
import { isProgrammaticSource } from "@opencut/editor-contracts";
import * as wasm from "opencut-wasm";
import { glassObjectGpuAssets } from "./glass-object-gpu-assets";
import type { LiquidCreator, ProbeOptions } from "./liquid-object-capture-probe-types";
import { errorReceipt } from "./liquid-object-capture-probe-types";

export const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function isRecord(value: unknown): value is Record<string, unknown> {
 return !!value && typeof value==="object" && !Array.isArray(value);
}
export function record(value: unknown): Record<string, unknown> {
 if(!isRecord(value))throw Error("Expected project probe object");return value;
}
const sorted = (value: unknown) => { if(!Array.isArray(value))throw Error("Expected Host collection");
 return value.map(record).sort((a,b)=>String(a.id).localeCompare(String(b.id))); };
export async function runLiquidProjectHost(options: ProbeOptions) {
 const { root, creator, threeToolchain }=options, projectRoot=join(root,"project"), input=join(root,"input");
 const report: Record<string,unknown>={ok:false,stage:"CPU-host-open",scope:"actual HeadlessHost transactions/FileProjectStore persistence, not editor UI history"};
 let host:RunningHost|undefined,opened=0,closed=0;
 const persist=()=>writeFile(join(root,"persistence-evidence.json"),JSON.stringify(report,null,2));
 const open=async()=>{host=await startHost({projectRoot,registry:new TargetRegistry(join(root,"registry")),engineToolchainDirectory:threeToolchain,htmlBrowserExecutable:"",htmlFrameConnectionFile:""});opened++;};
 const close=async()=>{if(host){await host.close();host=undefined;closed++;}};
 const request=async({route,body}:{route:string;body?:unknown})=>{
  assert(host);const response=await fetch(new URL(`api/${route}`,host.editorUrl),{signal:AbortSignal.timeout(30000),
   ...(body===undefined?{}:{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)})});
  const value:unknown=await response.json();assert.equal(response.status,200,`Host route ${route}: ${JSON.stringify(value)}`);return value;
 };
 const graph=async()=>({context:record(await request({route:"context"})),clips:sorted(await request({route:"clips"})),tracks:sorted(await request({route:"tracks"}))});
 try{
  await mkdir(input);await open();const initial=record(await request({route:"context"}));
  const THREE=await import(pathToFileURL(join(threeToolchain,"node_modules/three/build/three.module.js")).href);
  const asset=glassObjectGpuAssets(THREE)[0]!;const filePath=join(input,asset.id);await writeFile(filePath,asset.body,{flag:"wx"});
  const imported=record(await request({route:"programmatic/resources/import",body:{id:asset.id,kind:asset.kind,mimeType:asset.mimeType,filePath}}));
  const model=record(imported.resource);assert.equal(model.sha256,sha(asset.body));
  // Descriptor comes from the real Host import; the fixed helper validates model kind/id.
  const creatorApi:LiquidCreator=await import(pathToFileURL(join(creator,"liquid-object.mjs")).href);
  const resolver:unknown=Reflect.get(wasm,"resolveLiquidObjectParamsJson");if(typeof resolver!=="function")throw Error("Actual Liquid resolver missing");
  const resolveParams=(json:string)=>{const result:unknown=resolver(json);if(typeof result!=="string")throw Error("Resolver returned nontext");return result;};
  const { isProgrammaticResource }=await import("@opencut/editor-contracts");
  if(!isProgrammaticResource(model))throw Error("Host imported resource descriptor invalid");
  const shot=await creatorApi.liquidObjectThree({sourceDirectory:creator,model,
   settings:{width:192,height:128,durationFrames:61,frameRate:{numerator:30,denominator:1},seed:19},
   liquid:{amount:0.45,frequency:3,speed:1.5,twist:0.65},resolveParams});
  report.stage="CPU-compile";await persist();
  const compiled=record(await request({route:"programmatic/build/compile",body:shot.spec}));const source=compiled.source;
  if(!isProgrammaticSource(source) || !source.build)throw Error("Host compile returned invalid source");
  assert.deepEqual(source.build.capabilities,["liquid-object-v1"]);
  const project=record(initial.project);
  const applied=record(await request({route:"apply",body:{expectedRevision:initial.revision,operations:[
   {kind:"update-project",projectId:project.id,patch:{name:"Private Liquid persistence probe",canvasWidth:192,canvasHeight:128,frameRate:source.frameRate}},
   {kind:"create-track",track:{id:"liquid-track",name:"Liquid Object",kind:"graphic",hidden:false}},
   {kind:"create-clip",clip:{id:"liquid-object",trackId:"liquid-track",startTime:0,duration:244000,trimStart:0,trimEnd:0,
    editing:{type:"graphic",name:"Liquid Object",definitionId:"programmatic",params:{},effects:[],programmatic:source}}},
  ]}}));assert.equal(applied.accepted,true);
  const before=await graph();await close();const beforeBytes=await readFile(join(projectRoot,"project.json"));
  await rename(input,join(root,"unavailable-input"));await rename(creator,join(root,"unavailable-author"));
  await assert.rejects(access(filePath));await assert.rejects(access(join(creator,"liquid-object-scene.ts")));
  await open();const after=await graph();assert.deepEqual(after,before);
  assert((await readFile(join(projectRoot,"project.json"))).equals(beforeBytes),"Exact project bytes changed on reopen");
  const projectId=record(after.context.project).id;if(typeof projectId!=="string")throw Error("Persisted project ID missing");
  const store=new FileProjectStore({root:projectRoot,schemaVersion:32});const context={store,projectId};
  const attachments=[];
  for(const resource of [...(source.resources??[]),...source.build.inputs,source.build.toolchainLock]){
   const resolved=await loadProgrammaticResource({...context,resource});
   const bytes=await readFile(join(projectRoot,"attachments",resource.attachmentKey,"body.bin"));
   assert.equal(sha(bytes),resource.sha256);assert.equal(bytes.length,resource.byteLength);
   assert.equal(sha(new Uint8Array(resolved.body)),resource.sha256);
   attachments.push({id:resource.id,key:resource.attachmentKey,sha256:resource.sha256,bytes:resource.byteLength});
  }
  report.ok=true;report.stage="CPU-persistence-passed";report.source=source;report.projectId=projectId;
  report.projectSha256=sha(beforeBytes);report.attachments=attachments;report.graph=after;
  report.originalInputAndAuthorUnavailable=true;report.hostReopened=true;
  return {source,context,report,projectRoot};
 }catch(error){report.failure=errorReceipt(error);throw Object.assign(error instanceof Error?error:Error(String(error)),{receipt:report});}
 finally{await close();report.hostOpened=opened;report.hostClosed=closed;assert.equal(opened,closed);await persist();}
}

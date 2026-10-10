import {randomUUID,createHash} from "node:crypto";
import {mkdir,lstat,realpath,writeFile,rm} from "node:fs/promises";
import {resolve,join,relative,isAbsolute,dirname,sep} from "node:path";
import type {RemotionOwnedArtifact} from "./remotion-artifact-sink";

export interface RemotionArtifactOutput {
  directory:string;
  artifacts:{filename:string;path:string;byteLength:number;sha256:string;collectionFrame:number;nativeLocalFrame:number;downloadBehavior:unknown}[];
}
const inside=(root:string,path:string)=>{const child=relative(root,path);return child!=="" && child!==".." && !child.startsWith(".."+sep) && !isAbsolute(child);};
function logicalPath(filename:string):string[] {
  const parts=filename.split("/");
  if(!filename || filename.length>240 || parts.some(part=>!part || part==="." || part===".." || /[\\\x00-\x1f<>:"|?*]/.test(part)
    || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)))throw Error("Unsafe Remotion artifact logical path");
  return parts;
}
/** Authenticated Host-owned project destination; no caller-selected output path.
 * Parents and every created directory must remain real directories, never links.
 */
export async function writeRemotionArtifactOutputs({projectDir,artifacts,signal}:{
  projectDir:string;artifacts:readonly RemotionOwnedArtifact[];signal:AbortSignal;
}):Promise<RemotionArtifactOutput|undefined> {
  signal.throwIfAborted();if(!artifacts.length)return undefined;
  const project=resolve(projectDir);
  if(!isAbsolute(projectDir) || (await realpath(project))!==project || (await lstat(project)).isSymbolicLink())throw Error("Artifact project directory must be canonical");
  const checked=new Map<string,string>();checked.set(project,project);
  async function verify() {
    for(const [path,canonical] of checked) {
      const stat=await lstat(path);
      if(stat.isSymbolicLink() || !stat.isDirectory() || (await realpath(path))!==canonical)throw Error("Artifact output parent redirected");
    }
  }
  async function directory(path:string,exclusive=false) {
    await verify();
    try {await mkdir(path);}catch(error){if(exclusive || (error as NodeJS.ErrnoException).code!=="EEXIST")throw error;}
    const stat=await lstat(path),canonical=await realpath(path);
    if(stat.isSymbolicLink() || !stat.isDirectory() || canonical!==path || !inside(project,path))throw Error("Artifact output directory escaped its project");
    checked.set(path,canonical);await verify();
  }
  const exports=join(project,"exports"),parent=join(exports,"programmatic");
  await directory(exports);await directory(parent);
  const root=join(parent,"remotion-"+randomUUID());let created=false;
  try {
    await directory(root,true);created=true;
    const outputs:RemotionArtifactOutput["artifacts"]=[],names=new Set<string>();
    for(const artifact of artifacts) {
      signal.throwIfAborted();const parts=logicalPath(artifact.filename),path=join(root,...parts);
      if(!inside(root,path) || names.has(artifact.filename.toLowerCase()))throw Error("Conflicting artifact output filename");names.add(artifact.filename.toLowerCase());
      const hash=createHash("sha256").update(artifact.body).digest("hex");
      if(hash!==artifact.sha256)throw Error("Artifact output changed after fulfillment");
      let current=root;
      for(const part of parts.slice(0,-1)){current=join(current,part);if(!checked.has(current))await directory(current);}
      await verify();await writeFile(path,artifact.body,{flag:"wx"});await verify();
      const stat=await lstat(path);
      if(!stat.isFile() || stat.isSymbolicLink() || stat.size!==artifact.body.length || (await realpath(path))!==path)throw Error("Artifact file output redirected");
      outputs.push({filename:artifact.filename,path:relative(project,path).split(sep).join("/"),byteLength:artifact.body.length,sha256:hash,
        collectionFrame:artifact.collectionFrame,nativeLocalFrame:artifact.nativeLocalFrame,downloadBehavior:structuredClone(artifact.downloadBehavior)});
    }
    signal.throwIfAborted();await verify();return {directory:relative(project,root).split(sep).join("/"),artifacts:outputs};
  } catch(error) {
    if(created) {
      // A redirected parent makes recursive cleanup unsafe. Preserve it and
      // report failure rather than deleting through an ambiguous alias.
      try {await verify();if(dirname(root)!==parent || !inside(project,root))throw Error("Unsafe artifact cleanup");await rm(root,{recursive:true,force:true});}
      catch(cleanup){throw new AggregateError([error,cleanup],"Artifact output failed; unsafe or failed cleanup requires Host inspection");}
    }
    throw error;
  }
}

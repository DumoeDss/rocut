import {mkdir,writeFile,readFile,realpath,readdir} from "node:fs/promises";
import {join,resolve,relative,isAbsolute,sep} from "node:path";
import {createHash} from "node:crypto";
import {startHost} from "../../apps/cli/src/host";
import {TargetRegistry} from "../../apps/cli/src/target-registry";
import {REMOTION_PRODUCED_FUNCTIONAL_AUTHOR} from "./remotion-produced-functional-author";

function check(value:unknown,message:string):asserts value {if(!value)throw Error(message);}
export async function runRemotionProducedFunctional({root,toolchain,chromium,ffmpeg,ffprobe}:{
  root:string;toolchain:string;chromium:string;ffmpeg:string;ffprobe:string;
}) {
  const canonical=await realpath(root);check(canonical===resolve(root) && /^[cC]:[\\/]/.test(canonical),"Functional output must use its owned C-drive temp directory");
  const author=join(root,"author"),project=join(root,"project");await mkdir(author);
  await writeFile(join(author,"index.tsx"),REMOTION_PRODUCED_FUNCTIONAL_AUTHOR,{encoding:"utf8",flag:"wx"});
  const host=await startHost({projectRoot:project,registry:new TargetRegistry(join(root,"registry")),port:0,
    engineToolchainDirectory:toolchain,htmlBrowserExecutable:chromium,htmlFrameConnectionFile:"",nativeVideoDecoder:{ffmpeg,ffprobe}});
  const post=async(action:string,input:unknown,signal?:AbortSignal)=>{
    const response=await fetch(new URL("api/programmatic/"+action,host.editorUrl),{method:"POST",body:JSON.stringify(input),signal});
    const result=await response.json();check(response.ok,"Functional Host request failed: "+JSON.stringify(result));return result as any;
  };
  const compile=async(stall=false)=>(await post("build/compile",{version:1,engine:"remotion",sourceDirectory:author,
    entryFile:"index.tsx",files:["index.tsx"],compositionId:"ProducedFunctional",inputProps:{stall},width:64,height:32,
    frameRate:{numerator:30,denominator:1},durationFrames:8,seed:7,audio:{version:1,mode:"native"}})).source;
  async function ownedRead(path:string){
    check(typeof path==="string" && !isAbsolute(path),"Output metadata must be project-relative");
    const target=resolve(project,path),child=relative(project,target);check(child!==".." && !child.startsWith(".."+sep) && !isAbsolute(child),"Output escaped project");
    check(await realpath(target)===target,"Output must be a real owned file");return readFile(target);
  }
  async function verify(result:any){
    check(result.version===1 && result.hasAudio && result.output?.audio,"Missing real produced soundtrack delivery");
    const output=result.output,audio=output.audio;
    check(audio.format==="wav-f32le" && audio.channels===2 && audio.sampleRate===48000 && audio.frames===3200
      && audio.sampleOrigin===4800 && audio.firstFrame===3 && audio.frameCount===2,"Incorrect cropped native soundtrack geometry");
    const wav=await ownedRead(audio.path);check(wav.length===56+3200*8 && wav.toString("ascii",0,4)==="RIFF"
      && wav.readUInt16LE(20)===3 && wav.toString("ascii",36,40)==="fact" && wav.readUInt32LE(44)===3200,"Invalid real float WAV");
    check(createHash("sha256").update(wav).digest("hex")===audio.sha256,"Soundtrack output hash changed");
    for(let frame=0;frame<3200;frame++)for(let channel=0;channel<2;channel++) {
      const expected=(frame<1600?4000:5000)/32768;
      check(wav.readFloatLE(56+(frame*2+channel)*4)===expected,"Native overwrite/history/crop sample mismatch");
    }
    const records=[];
    for(let frame=0;frame<8;frame++){
      const artifact=output.artifacts.find((item:any)=>item.filename===`history/frame-${frame}.json`);check(artifact,"Canonical source history missing frame "+frame);
      const record=JSON.parse((await ownedRead(artifact.path)).toString("utf8"));check(record.frame===frame && record.visits===frame+1,"Continuous root state did not survive canonical seek");records.push(record);
    }
    check(new Set(records.map(record=>record.id)).size===1,"Native inline identity changed across the same root");
    const empty=output.artifacts.find((item:any)=>item.filename==="empty.bin");check(empty && empty.byteLength===0 && (await ownedRead(empty.path)).length===0,"Empty binary artifact was not fulfilled");
    const space=output.artifacts.find((item:any)=>item.filename==="whitespace.txt");check(space && (await ownedRead(space.path)).toString("utf8")===" \n\t","Whitespace artifact changed");
    const thumb=output.artifacts.find((item:any)=>item.filename==="frame-two.png");check(thumb && thumb.collectionFrame===2 && thumb.nativeLocalFrame===0,"Thumbnail used wrong native collection/local frame");
    const png=await ownedRead(thumb.path);check(png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      && png.readUInt32BE(16)===64 && png.readUInt32BE(20)===32,"Real thumbnail PNG geometry invalid");
    check(output.artifacts.length===11,"Unexpected artifact outputs or failed dedupe");
    return {directory:output.directory,audio,thumbnail:thumb,nativeId:records[0].id,canonicalFrames:records.length};
  }
  try {
    const source=await compile();check(source.build?.engineVersion==="4.0.440" && source.build.toolchainLock && source.documentId,"Compile did not archive the native source/toolchain");
    const request={source,firstFrame:3,frameCount:2,sampleRate:48000};
    await writeFile(join(author,"index.tsx"),"throw Error('live author must not be re-read by produced archive');",{encoding:"utf8"});
    const first=await verify(await post("produced",request));
    await writeFile(join(author,"index.tsx"),REMOTION_PRODUCED_FUNCTIONAL_AUTHOR,{encoding:"utf8"});
    const stalled=await compile(true),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),500);
    let cancelled=false;
    try {await post("produced",{...request,source:stalled},controller.signal);}catch(error){check(controller.signal.aborted,"Cancellation did not reach the client lifetime");cancelled=true;}
    finally{clearTimeout(timer);}check(cancelled,"Stalled produced scan unexpectedly succeeded");
    let second:any;
    // Client abort may precede server drain. Retry only the documented busy
    // response; no shared browser, port, or externally owned process is used.
    for(let attempt=0;attempt<40;attempt++){
      try {second=await verify(await post("produced",request));break;}
      catch(error){if(!/busy|slots|concurrent/i.test(String(error)))throw error;await new Promise(resolve=>setTimeout(resolve,100));}
    }
    check(second && second.directory!==first.directory,"Fresh retry did not create an independent fulfilled output transaction");
    const runs=await readdir(join(project,"exports","programmatic"));check(runs.length===2,"Cancelled job published an output directory");
    const report={version:1,status:"functional-pass",scope:"native-registration-and-produced-consumer; not @remotion/media decode or pixel-MAE",first,retry:second,cancelled,
      sourceArchive:{documentId:source.documentId,toolchainLock:source.build.toolchainLock},outputRoot:root};
    await writeFile(join(root,"remotion-produced-functional-report.json"),JSON.stringify(report,null,2),{encoding:"utf8",flag:"wx"});return report;
  } finally {await host.close();}
}

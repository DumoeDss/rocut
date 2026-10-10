import {createHash} from "node:crypto";

export interface RemotionAdmittedArtifact {
  id:string;filename:string;nativeLocalFrame:number;collectionFrame:number;contentType:"text"|"binary"|"thumbnail";
  downloadBehavior:unknown;body:{encoding:"utf8"|"base64";data:string}|null;byteLength:number;sha256:string|null;
  requiresCapture:"exact-frame-png"|null;outputStatus:"requires-owned-host-artifact-sink";
}
export interface RemotionOwnedArtifact {
  filename:string;body:Buffer;sha256:string;collectionFrame:number;nativeLocalFrame:number;downloadBehavior:unknown;
}
/** Job-owned outputs, never user files or static resources. Export code must
 * explicitly consume these buffers into its requested artifact destination. */
export function createRemotionArtifactSink({limits,signal,captureFramePng}:{
  limits:{maxSourceBytes:number;maxTotalBytes:number;maxSources:number};signal:AbortSignal;
  captureFramePng?:(frameIndex:number)=>Promise<Buffer>;
}) {
  const outputs=new Map<string,RemotionOwnedArtifact>();let bytes=0,disposed=false,busy=false;
  const check=()=>{signal.throwIfAborted();if(disposed)throw Error("Remotion artifact sink disposed");};
  return {
    async accept(artifact:RemotionAdmittedArtifact) {
      check();if(busy)throw Error("Remotion artifacts must be consumed serially");busy=true;
      try {
        if(artifact.outputStatus!=="requires-owned-host-artifact-sink")throw Error("Unadmitted Remotion artifact output");
        let body:Buffer;
        if(artifact.requiresCapture!==null) {
          if(artifact.requiresCapture!=="exact-frame-png" || artifact.body!==null || !captureFramePng)
            throw Error("Remotion thumbnail requires owned exact-frame picture capture");
          body=Buffer.from(await captureFramePng(artifact.collectionFrame));check();
          if(body.length<8 || !body.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))
            throw Error("Remotion thumbnail capture did not produce PNG bytes");
        } else {
          if(!artifact.body)throw Error("Remotion artifact has no admitted output bytes");
          body=Buffer.from(artifact.body.data,artifact.body.encoding==="utf8"?"utf8":"base64");
          if(body.length!==artifact.byteLength)throw Error("Remotion artifact bytes changed after admission");
        }
        const sha256=createHash("sha256").update(body).digest("hex");
        if(artifact.sha256!==null && sha256!==artifact.sha256)throw Error("Remotion artifact hash changed after admission");
        if(body.length>limits.maxSourceBytes)throw Error("Remotion artifact output exceeds the Rust byte budget");
        const previous=outputs.get(artifact.filename);
        if(previous) {
          if(previous.sha256!==sha256)throw Error("Conflicting Remotion artifact filename across native frames");
          return;
        }
        if(outputs.size>=limits.maxSources || bytes+body.length>limits.maxTotalBytes)
          throw Error("Remotion artifact outputs exceed the Rust job budget");
        outputs.set(artifact.filename,{filename:artifact.filename,body,sha256,collectionFrame:artifact.collectionFrame,
          nativeLocalFrame:artifact.nativeLocalFrame,downloadBehavior:structuredClone(artifact.downloadBehavior)});
        bytes+=body.length;
      } finally {busy=false;}
    },
    take():RemotionOwnedArtifact[] {check();const result=[...outputs.values()].map(item=>({...item,body:Buffer.from(item.body),downloadBehavior:structuredClone(item.downloadBehavior)}));outputs.clear();bytes=0;return result;},
    dispose(){disposed=true;outputs.clear();bytes=0;},
  };
}

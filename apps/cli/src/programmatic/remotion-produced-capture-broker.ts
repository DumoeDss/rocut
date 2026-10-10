import type { launchFrameBrowser } from "./chromium-process";

/** Screenshots are fulfilled while the continuous native root is paused. */
export async function attachRemotionProducedCaptureBroker({browser,session,durationFrames,limits,signal}:{
  browser:Pick<Awaited<ReturnType<typeof launchFrameBrowser>>,"send"|"onEvent">;session:string;
  durationFrames:number;limits:{maxSourceBytes:number;maxTotalBytes:number};signal:AbortSignal;
}) {
  const pictures=new Map<number,Buffer>();let total=0,failure:Error|undefined,disposed=false,busy=false;
  const jobs=new Set<Promise<void>>();const seen=new Set<number>();
  const local=new AbortController(),lifetime=AbortSignal.any([signal,local.signal]);
  async function cancellable<T>(operation:Promise<T>):Promise<T> {
    lifetime.throwIfAborted();
    return new Promise<T>((resolve,reject)=>{
      const abort=()=>reject(lifetime.reason);lifetime.addEventListener("abort",abort,{once:true});
      operation.then(resolve,reject).finally(()=>lifetime.removeEventListener("abort",abort));
      if(lifetime.aborted)abort();
    });
  }
  const unsubscribe=browser.onEvent(event=>{
    if(disposed || event.sessionId!==session || event.method!=="Runtime.bindingCalled" || event.params.name!=="__rocutProducedCaptureRequest")return;
    const contextId=event.params.executionContextId;let requestId:unknown;
    const job=(async()=>{
      try {
        lifetime.throwIfAborted();
        if(typeof event.params.payload!=="string" || event.params.payload.length>1024 || !Number.isSafeInteger(contextId))throw Error("Invalid produced capture transport");
        const request=JSON.parse(event.params.payload);requestId=request.requestId;
        if(request.version!==1 || request.kind!=="remotion-produced-thumbnail" || !Number.isSafeInteger(requestId) || Number(requestId)<1
          || !Number.isSafeInteger(request.frameIndex) || request.frameIndex<0 || request.frameIndex>=durationFrames || seen.has(Number(requestId)))throw Error("Invalid produced capture request");
        if(busy || pictures.has(request.frameIndex))throw Error("Produced capture must pause and serialize native frames");busy=true;
        seen.add(Number(requestId));
        const result=await cancellable(browser.send("Page.captureScreenshot",{format:"png",fromSurface:true,captureBeyondViewport:false},session));
        lifetime.throwIfAborted();if(disposed)throw Error("Produced capture disposed");
        if(typeof result.data!=="string" || result.data.length>Math.ceil(limits.maxSourceBytes/3)*4)throw Error("Produced thumbnail exceeds the Rust byte budget");
        const body=Buffer.from(result.data,"base64");
        if(!body.length || body.length>limits.maxSourceBytes || total+body.length>limits.maxTotalBytes || !body.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error("Invalid or oversized produced PNG");
        pictures.set(request.frameIndex,body);total+=body.length;
        await reply({requestId,ok:true});
      } catch(error) {
        failure??=error instanceof Error?error:Error("Produced capture failed");
        if(requestId!==undefined && !lifetime.aborted)await reply({requestId,error:failure.message}).catch(()=>{});
      } finally {busy=false;}
      async function reply(value:object) {
        const result=await cancellable(browser.send("Runtime.evaluate",{contextId,expression:`window.__rocutProducedCaptureReply(${JSON.stringify(value).replace(/</g,"\\u003c")})`},session));
        if(result.exceptionDetails)throw Error("Produced capture reply failed");
      }
    })();jobs.add(job);void job.finally(()=>jobs.delete(job));
  });
  try {await browser.send("Runtime.addBinding",{name:"__rocutProducedCaptureRequest"},session);}catch(error){unsubscribe();throw error;}
  return {
    async check(){await Promise.all(jobs);if(failure)throw failure;signal.throwIfAborted();},
    take(){lifetime.throwIfAborted();if(failure)throw failure;if(jobs.size || busy)throw Error("Produced captures have not settled");return new Map(pictures);},
    async dispose(){disposed=true;unsubscribe();local.abort(Error("Produced capture disposed"));await Promise.allSettled(jobs);pictures.clear();},
  };
}

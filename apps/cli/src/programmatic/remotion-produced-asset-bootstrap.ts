/** Pinned registerRenderAsset IO. These bytes are authored outputs, not URLs or
 * declared resources. Rust owns admission, clocks, ToInt16 and output policy. */
export const REMOTION_PRODUCED_ASSET_BOOTSTRAP=String.raw`
function createRocutRemotionProducedAssetCollector(limits,mediaCount=()=>0) {
  for(const field of ['maxSourceBytes','maxTotalBytes','maxAssetsPerFrame','maxObservationBytes'])
    if(!Number.isSafeInteger(limits?.[field]) || limits[field]<=0)throw Error('Missing Rust produced asset IO budget: '+field);
  const assets=new Map(), sizes=new Map();
  let total=0,failure;
  const fail=message=>{failure??=Error(message);throw failure;};
  const healthy=()=>{if(failure)throw failure;};
  const finite=value=>{if(typeof value!=='number'||!Number.isFinite(value))fail('Nonfinite native produced fact');return value;};
  const text=value=>{if(typeof value!=='string')fail('Native produced string fact missing');return value;};
  const bounded=(size,prior)=>{if(size>limits.maxSourceBytes || total-prior+size>limits.maxTotalBytes)fail('Native produced bytes exceed the Rust budget');};
  const copyDownload=value=>{
    if(value===null)return null;
    if(!value || typeof value!=='object')fail('Invalid native artifact download fact');
    if(value.type==='play-in-browser' && Object.keys(value).length===1)return {type:value.type};
    if(value.type==='download' && Object.keys(value).every(key=>['type','fileName'].includes(key)))
      return {type:value.type,fileName:value.fileName===null?null:text(value.fileName)};
    fail('Unknown native artifact download fact');
  };
  return Object.freeze({
    register(asset) {
      healthy();
      if(!asset || !['inline-audio','artifact'].includes(asset.type))fail('Expected native produced asset');
      const id=text(asset.id),prior=sizes.get(id)||0;
      const count=assets.size+(assets.has(id)?0:1)+mediaCount();
      if(!Number.isInteger(count)||count>limits.maxAssetsPerFrame)fail('Native media and produced count exceeds the Rust budget');
      let copied,size;
      if(asset.type==='inline-audio') {
        if(!(asset.audio instanceof Int16Array) && !Array.isArray(asset.audio))fail('Expected native Int16Array or number[] PCM');
        const length=asset.audio.length;
        if(!Number.isInteger(length)||length<0)fail('Invalid native PCM length');
        size=length*2;bounded(size,prior);
        const audio=[];let transportBytes=1024;
        for(let index=0;index<length;index++) {
          const value=finite(asset.audio[index]);transportBytes+=String(value).length+1;
          if(transportBytes>limits.maxObservationBytes)fail('Native PCM transport exceeds the Rust observation budget');
          audio.push(value);
        }
        copied={type:asset.type,id,audio,frame:finite(asset.frame),timestamp:finite(asset.timestamp),
          duration:finite(asset.duration),toneFrequency:finite(asset.toneFrequency)};
      } else {
        const contentType=text(asset.contentType),filename=text(asset.filename),frame=finite(asset.frame);
        copied={type:asset.type,id,filename,frame,contentType,downloadBehavior:copyDownload(asset.downloadBehavior)};
        if(contentType==='thumbnail') {
          if(asset.content!==undefined)fail('Native thumbnail cannot pretend to have rendered bytes');
          size=0;
        } else {
          const content=text(asset.content);
          if(contentType==='text') {
            if(content.length>limits.maxSourceBytes)fail('Native artifact text exceeds its byte budget');
            size=new TextEncoder().encode(content).length;
          }
          else if(contentType==='binary') {
            if(content.length>Math.ceil(limits.maxSourceBytes/3)*4)fail('Native artifact base64 exceeds its byte budget');
            size=atob(content).length;
          } else fail('Unknown native artifact content discriminant');
          copied.content=content;bounded(size,prior);
        }
      }
      assets.set(id,copied);sizes.set(id,size);total=total-prior+size;
    },
    unregister(id){healthy();total-=sizes.get(id)||0;sizes.delete(id);assets.delete(id);},
    snapshot(){healthy();const result=[...assets.values()].map(asset=>({...asset,
      ...(asset.audio?{audio:asset.audio.slice()}:{}),...(asset.downloadBehavior?{downloadBehavior:{...asset.downloadBehavior}}:{})}));
      if(new TextEncoder().encode(JSON.stringify(result)).length>limits.maxObservationBytes)
        fail('Native produced snapshot exceeds the Rust observation budget');
      return result;},
    size(){healthy();return assets.size;},
    dispose(){assets.clear();sizes.clear();total=0;failure=Error('Native produced collector disposed');}
  });
}
`;

import type {
	LiquidTransportFrame,
	LiquidTransportPolicy,
} from "./engines/three-liquid-object-transport-publication";

export interface LiquidObjectPageConfig {
	version: 1;
	frame: LiquidTransportFrame;
	policy: LiquidTransportPolicy;
}

/** Complete outer relay bytes. The iframe has an opaque origin, scripts only. */
export const LIQUID_OBJECT_CAPTURE_BOOTSTRAP = String.raw`
(config,bootstrap,code,csp)=>new Promise((resolve,reject)=>{
 document.documentElement.style.cssText='margin:0; background:transparent';
 document.body.style.cssText='margin:0; background:transparent; overflow:hidden';
 const iframe=document.createElement('iframe');
 iframe.sandbox='allow-scripts';
 iframe.style.cssText='position:fixed; inset:0; width:100%; height:100%; border:0; background:transparent';
 const waiting=new Map();let closed=false,cleanupPromise;
 const invoke=(tag,ack,timeout)=>new Promise((done,failed)=>{
  const id=Array.from(crypto.getRandomValues(new Uint8Array(16)),v=>v.toString(16).padStart(2,'0')).join('');
  const timer=setTimeout(()=>{waiting.delete(id);failed(Error('Liquid page acknowledgement timed out'));},timeout);
  waiting.set(id,{ack,done,failed,timer});
  try {
   if(!iframe.contentWindow) throw Error('Liquid iframe unavailable');
   iframe.contentWindow.postMessage({tag,id},'*');
  } catch(error){clearTimeout(timer);waiting.delete(id);failed(error);}
 });
 const check=()=>closed ? Promise.reject(Error('Liquid page is closing')) :
  invoke('rocut-liquid-object-check-request','rocut-liquid-object-check-ack',config.policy.requestTimeoutMs);
 Object.defineProperty(window,'__rocutLiquidObjectCheck',{value:check});
 Object.defineProperty(window,'__rocutLiquidObjectCleanup',{value:()=>{
  if(!cleanupPromise){closed=true;cleanupPromise=invoke('rocut-liquid-object-cleanup-request',
   'rocut-liquid-object-cleanup-ack',config.policy.cleanupTimeoutMs);}
  return cleanupPromise;
 }});
 Object.defineProperty(window,'__rocutLiquidObjectReply',{value:reply=>{
  iframe.contentWindow?.postMessage({tag:'rocut-liquid-object-reply',reply},'*');
 }});
 addEventListener('message',event=>{
  if(event.source!==iframe.contentWindow) return;
  const data=event.data;
  if(data?.tag==='rocut-liquid-object-cleanup-ack' || data?.tag==='rocut-liquid-object-check-ack'){
   const entry=waiting.get(data.id);if(!entry || data.tag!==entry.ack) return;
   waiting.delete(data.id);clearTimeout(entry.timer);
   if(data.ok===true && !Object.hasOwn(data,'error')) entry.done();
   else entry.failed(Error(typeof data.error==='string' ? data.error : 'Invalid Liquid page acknowledgement'));
   return;
  }
  if(data?.tag==='rocut-liquid-object-request'){
   if(closed || typeof data.payload!=='string' || typeof window.__rocutLiquidObjectRequest!=='function'){
    reject(Error('Liquid frame transport unavailable'));return;
   }
   try {Promise.resolve(window.__rocutLiquidObjectRequest(data.payload)).catch(reject);}catch(error){reject(error);}
   return;
  }
  if(data?.tag!=='rocut-html-frame') return;
  if(data.ok!==true){reject(Error(data.error??'Liquid frame failed'));return;}
  check().then(()=>requestAnimationFrame(()=>requestAnimationFrame(()=>check().then(()=>resolve(true),reject))),reject);
 });
 const configuration=';Object.defineProperty(window,"__rocutLiquidObjectConfig",{value:'+JSON.stringify(config).replace(/</g,'\\u003c')+'});';
 iframe.srcdoc='<meta http-equiv="Content-Security-Policy" content="'+csp+'"><script>'+bootstrap+configuration+'</script>'+code;
 document.body.appendChild(iframe);
})`;

export function liquidObjectCaptureExpression(options: {
	config: LiquidObjectPageConfig;
	bootstrap: string;
	code: string;
	csp: string;
}): string {
	return `(${LIQUID_OBJECT_CAPTURE_BOOTSTRAP})(...${JSON.stringify([
		options.config,
		options.bootstrap,
		options.code,
		options.csp,
	])})`;
}

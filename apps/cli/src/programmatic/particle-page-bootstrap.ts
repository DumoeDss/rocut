import { PARTICLE_BROWSER_RUNTIME_IIFE } from "./particle-browser-bundle.generated";
import {
	PARTICLE_BINDING_NAME,
	PARTICLE_REPLY_NAME,
} from "./particle-protocol";
import {
	PARTICLE_CONFIG_NAME,
	PARTICLE_PAGE_CLEANUP_NAME,
	PARTICLE_PAGE_CHECK_NAME,
	PARTICLE_REQUEST_TAG,
	PARTICLE_REPLY_TAG,
	PARTICLE_CLEANUP_REQUEST_TAG,
	PARTICLE_CLEANUP_ACK_TAG,
	PARTICLE_CHECK_REQUEST_TAG,
	PARTICLE_CHECK_ACK_TAG,
	type ParticlePageConfig,
} from "./particle-page-contract";

/** Complete opt-in outer relay, inner configuration installation and cleanup
 * handshake. These exact static bytes are included in the particle adapter hash. */
export const PARTICLE_CAPTURE_BOOTSTRAP = String.raw`
(config,bootstrap,code,csp,runtime) => new Promise((resolve,reject) => {
  document.documentElement.style.cssText='margin:0; background:transparent';
  document.body.style.cssText='margin:0; background:transparent; overflow:hidden';
  const iframe=document.createElement('iframe');
  iframe.sandbox='allow-scripts';
  iframe.style.cssText='position:fixed; inset:0; width:100%; height:100%; border:0; background:transparent';
  const waiting=new Map();
  let cleanupPromise,closed=false;
  const invoke=(tag,ack,timeout)=>new Promise((done,failed)=>{
    const id=Array.from(crypto.getRandomValues(new Uint8Array(16)),v=>v.toString(16).padStart(2,'0')).join('');
    const timer=setTimeout(()=>{waiting.delete(id);failed(Error('Particle page acknowledgement timed out'));},timeout);
    waiting.set(id,{ack,done,failed,timer});
    try {
      if(!iframe.contentWindow) throw Error('Particle iframe is unavailable');
      iframe.contentWindow.postMessage({tag,id},'*');
    } catch(error) { clearTimeout(timer);waiting.delete(id);failed(error); }
  });
  const check=()=>closed ? Promise.reject(Error('Particle page is closing')) : invoke(${JSON.stringify(PARTICLE_CHECK_REQUEST_TAG)},${JSON.stringify(PARTICLE_CHECK_ACK_TAG)},config.requestTimeoutMs);
  Object.defineProperty(window,${JSON.stringify(PARTICLE_PAGE_CHECK_NAME)},{value:check});
  Object.defineProperty(window,${JSON.stringify(PARTICLE_PAGE_CLEANUP_NAME)},{value:()=>{
    if(!cleanupPromise) {
      closed=true;
      cleanupPromise=invoke(${JSON.stringify(PARTICLE_CLEANUP_REQUEST_TAG)},${JSON.stringify(PARTICLE_CLEANUP_ACK_TAG)},config.policy.cleanupTimeoutMs);
    }
    return cleanupPromise;
  }});
  Object.defineProperty(window,${JSON.stringify(PARTICLE_REPLY_NAME)},{value:reply=>{
    iframe.contentWindow?.postMessage({tag:${JSON.stringify(PARTICLE_REPLY_TAG)},reply},'*');
  }});
  Object.defineProperty(window,'__rocutNativeFrameReply',{value:reply=>{
    iframe.contentWindow?.postMessage({tag:'rocut-native-frame-reply',reply},'*');
  }});
  addEventListener('message',event=>{
    if(event.source!==iframe.contentWindow) return;
    const data=event.data;
    if(data?.tag===${JSON.stringify(PARTICLE_CLEANUP_ACK_TAG)} || data?.tag===${JSON.stringify(PARTICLE_CHECK_ACK_TAG)}) {
      const entry=waiting.get(data.id);
      if(!entry || data.tag!==entry.ack) return;
      waiting.delete(data.id);clearTimeout(entry.timer);
      if(data.ok===true && !Object.hasOwn(data,'error')) entry.done();
      else entry.failed(Error(typeof data.error==='string' ? data.error : 'Invalid particle page acknowledgement'));
      return;
    }
    if(data?.tag===${JSON.stringify(PARTICLE_REQUEST_TAG)}) {
      if(closed || typeof data.payload!=='string' || typeof window[${JSON.stringify(PARTICLE_BINDING_NAME)}]!=='function') {
        reject(Error('Particle frame transport is unavailable')); return;
      }
      try { Promise.resolve(window[${JSON.stringify(PARTICLE_BINDING_NAME)}](data.payload)).catch(reject); } catch(error) { reject(error); }
      return;
    }
    if(data?.tag==='rocut-native-frame-request') {
      if(typeof window.__rocutNativeFrameRequest==='function' && typeof data.payload==='string') window.__rocutNativeFrameRequest(data.payload);
      else reject(Error('Native frame transport is unavailable'));
      return;
    }
    if(data?.tag!=='rocut-html-frame') return;
    if(!data.ok) { reject(Error(data.error)); return; }
    check().then(()=>requestAnimationFrame(()=>requestAnimationFrame(()=>check().then(()=>resolve(true),reject))),reject);
  });
  const configuration=';Object.defineProperty(window,'+${JSON.stringify(JSON.stringify(PARTICLE_CONFIG_NAME))}+', {value:'+JSON.stringify(config).replace(/</g,'\\u003c')+'});';
  iframe.srcdoc='<meta http-equiv="Content-Security-Policy" content="'+csp+'"><script>'+bootstrap+configuration+runtime+'</script>'+code;
  document.body.appendChild(iframe);
})`;

export function particleCaptureExpression(options: {
	config: ParticlePageConfig;
	bootstrap: string;
	code: string;
	csp: string;
}): string {
	return `(${PARTICLE_CAPTURE_BOOTSTRAP})(...${JSON.stringify([
		options.config,
		options.bootstrap,
		options.code,
		options.csp,
		PARTICLE_BROWSER_RUNTIME_IIFE,
	])})`;
}

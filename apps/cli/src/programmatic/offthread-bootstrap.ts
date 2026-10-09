/** Native Remotion fetch seam only. No general fetch override or network grant. */
export const OFFTHREAD_BOOTSTRAP = String.raw`
const nativePending = new Map();
let nativeSequence = 0;
const nativeBinding = nativeVideoBridge
  ? payload => parent.postMessage({tag:'rocut-native-frame-request',payload}, '*') : undefined;
Object.defineProperty(window, '__rocutNativeFrameReply', {value:reply => {
  const pending = nativePending.get(reply.id);
  if (!pending) return;
  nativePending.delete(reply.id); pending.cleanup();
  if (reply.error) pending.reject(Error(reply.error));
  else {
    const bytes = Uint8Array.from(atob(reply.png), c => c.charCodeAt(0));
    pending.resolve(new Response(bytes, {status:200, headers:{'content-type':'image/png'}}));
  }
}});
addEventListener('message', event => {
  if (event.source === parent && event.data?.tag === 'rocut-native-frame-reply')
    window.__rocutNativeFrameReply(event.data.reply);
});
Object.defineProperty(window, 'rocutOffthread', {value:Object.freeze({
  available: typeof nativeBinding === 'function',
  async fetch(actualSrc, options) {
    if (typeof nativeBinding !== 'function') throw Error('OffthreadVideo requires the native frame bridge on this backend');
    const url = new URL(actualSrc);
    if (url.origin !== 'http://localhost:0' || url.pathname !== '/proxy' || url.username || url.password || url.hash)
      throw Error('Invalid native OffthreadVideo request');
    const signal = options?.signal;
    signal?.throwIfAborted();
    const id = ++nativeSequence;
    const input = {version:1,kind:'frame',id,src:url.searchParams.get('src'),seconds:Number(url.searchParams.get('time')),
      transparent:url.searchParams.get('transparent') === 'true',toneMapped:url.searchParams.get('toneMapped') === 'true'};
    return new Promise((resolve,reject) => {
      const abort = () => {
        if (!nativePending.delete(id)) return;
        cleanup();
        nativeBinding(JSON.stringify({version:1,kind:'cancel',id}));
        reject(new DOMException('Native video request aborted','AbortError'));
      };
      const cleanup = () => signal?.removeEventListener('abort',abort);
      nativePending.set(id,{resolve,reject,cleanup});
      signal?.addEventListener('abort',abort,{once:true});
      try { nativeBinding(JSON.stringify(input)); }
      catch (error) { nativePending.delete(id); cleanup(); reject(error); }
      if (signal?.aborted) { cleanup(); abort(); }
    });
  }
})});
`;

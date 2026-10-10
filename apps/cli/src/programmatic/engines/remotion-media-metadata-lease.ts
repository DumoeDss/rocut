/** Browser IO lifetime only. Native Remotion still owns media durations and
 * delay/cancel policy; this lease prevents a retired ref from publishing IO. */
export const REMOTION_MEDIA_METADATA_LEASE_SOURCE = String.raw`
function rocutNativeMediaMetadataLease({element,read,apply,release,cancel}) {
  const controller=new AbortController();
  let active=true,released=false;
  const releaseOnce=()=>{if(!released){released=true;release();}};
  void (async()=>{
    try {
      const duration=await read(element,controller.signal);
      if(active && !controller.signal.aborted) apply(duration);
    } catch(error) {
      if(active && !controller.signal.aborted) {
        // Pinned native cancelRender records remotion_cancelledError before
        // throwing. The driver's normal readiness check observes that failure;
        // consume its intentional throw, not an unhandled promise rejection.
        try {cancel(error);} catch {}
      }
    } finally {releaseOnce();}
  })();
  return ()=>{
    if(!active) return;
    active=false;
    controller.abort();
    try {element.removeAttribute('src');element.load();}
    finally {releaseOnce();}
  };
}
`;

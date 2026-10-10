/** Pause the persistent native root until the host owns the exact-frame PNG.
 * No image bytes return to the authored realm; only a matching receipt does.
 */
export const REMOTION_PRODUCED_THUMBNAIL_CAPTURE = String.raw`
(() => {
  let serial = 0, pending = false;
  Object.defineProperty(window,'rocutRemotionProducedCapture',{value:async frame => {
    if (pending) throw Error('Native thumbnail captures must be serial');
    pending = true;
    try {
      checkHtmlMedia(true);
      await Promise.all([...document.images].map(image => image.decode()));
      await document.fonts.ready;
      if (document.getAnimations().some(animation => !['idle','finished'].includes(animation.playState)))
        throw Error('Native continuous thumbnail capture does not support active CSS animations');
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      checkHtmlMedia(true);
      if (failures.length) throw Error(failures[0]);
      const requestId = ++serial;
      await new Promise((resolve,reject) => {
        const cleanup = () => {clearTimeout(timer);removeEventListener('message',reply);};
        const reply = event => {
          if (event.source !== parent || event.data?.tag !== 'rocut-produced-capture-reply'
              || event.data.reply?.requestId !== requestId) return;
          cleanup();
          if (event.data.reply.ok === true) resolve();
          else reject(Error(event.data.reply.error || 'Native thumbnail capture failed'));
        };
        const timer = setTimeout(() => {cleanup();reject(Error('Native thumbnail capture timed out'));},8000);
        addEventListener('message',reply);
        try {
          parent.postMessage({tag:'rocut-produced-capture-request',payload:JSON.stringify({
            version:1,kind:'remotion-produced-thumbnail',requestId,frameIndex:frame.index
          })},'*');
        } catch(error) {cleanup();reject(error);}
      });
    } finally {pending = false;}
  }});
})();
`;

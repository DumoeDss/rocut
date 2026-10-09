import { IMAGE_DIMENSIONS_WORKER_SOURCE } from "./image-dimensions-worker";

/** Fixed Canvas mechanism. Only an admitted image and Rust request cross in. */
export const IMAGE_PREPROCESS_DOCUMENT = `<!doctype html>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; worker-src 'none'; connect-src 'none'; img-src 'none'; style-src 'none'; frame-src 'none'">
<script>
"use strict";
(() => {
  let disposed=false, started=false, imageAssets, canvas;
  const nativeBitmap=globalThis.createImageBitmap.bind(globalThis), owned=new Set();
  const createImageBitmap=async (...args)=>{
    const bitmap=await nativeBitmap(...args);
    if(disposed){bitmap.close();throw Error('Image preprocessing cancelled');}
    owned.add(bitmap);return bitmap;
  };
  const cleanup=()=>{if(imageAssets)imageAssets.close();for(const bitmap of owned)bitmap.close();owned.clear();if(canvas)canvas.width=canvas.height=1;};
  ${IMAGE_DIMENSIONS_WORKER_SOURCE}
  addEventListener('message',function connect(event){
    if(event.source!==parent||event.data?.type!=='rocut-image-preprocess-connect-v1'||event.ports.length!==1)return;
    removeEventListener('message',connect);
    const port=event.ports[0],id=event.data.id;
    const send=(type,data={},transfer=[])=>port.postMessage({id,type,...data},transfer);
    port.onmessage=async ({data})=>{
      if(data?.id!==id)return;
      if(data.type==='dispose'){disposed=true;cleanup();send('disposed');port.close();return;}
      if(disposed||started||data.type!=='readback')return;
      started=true;
      try{
        const {request,item,admission,limits}=data.input;
        const {binding,roi}=request;
        if(!sameMvImageIdentity(binding.resource,item.resource)||!sameMvImageIdentity(binding.resource,admission.resource))throw Error('Preprocess image identity mismatch');
        imageAssets=await decodeMvDeclaredImages({imageDecodeLimits:limits},[item],[admission],'render',createMvImageDecodeBudget(limits));
        if(disposed)throw Error('Image preprocessing cancelled');
        const image=imageAssets.images.get(item.resource.id);
        if(image.width!==binding.width||image.height!==binding.height)throw Error('Preprocess actual decoded dimensions mismatch');
        if(![roi.x,roi.y,roi.width,roi.height].every(Number.isSafeInteger)||roi.x<0||roi.y<0||roi.width<=0||roi.height<=0||roi.x+roi.width>image.width||roi.y+roi.height>image.height)throw Error('Preprocess ROI mismatch');
        canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
        const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw Error('Preprocess Canvas2D unavailable');
        ctx.drawImage(image,0,0);
        const rgba=ctx.getImageData(roi.x,roi.y,roi.width,roi.height).data;
        if(disposed)throw Error('Image preprocessing cancelled');
        send('rgba',{rgba:rgba.buffer,width:image.width,height:image.height},[rgba.buffer]);
      }catch(error){if(!disposed)send('error',{error:String(error).slice(0,2000)});}
      finally{cleanup();}
    };
    send('ready');
  });
})();
</script>`;

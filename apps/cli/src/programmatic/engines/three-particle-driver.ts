import { THREE_PARTICLE_ASSETS_DRIVER } from "./three-assets-driver";

/** Opt-in only. The ordinary THREE_FRAME_DRIVER remains byte-for-byte intact. */
export const THREE_PARTICLE_FRAME_DRIVER =
	String.raw`
import * as THREE from 'three';
import {createScene} from 'rocut:entry';
` +
	THREE_PARTICLE_ASSETS_DRIVER +
	String.raw`
const spec=window.__rocutThreeSpec;
const particles=window.__rocutClaimParticleRuntime();
window.rocut={async renderFrame(frame){
  const controller=new AbortController();
  const assets=createAssets(frame,controller.signal);
  const canvas=document.createElement('canvas');
  canvas.style.cssText='display:block;width:100%;height:100%'; document.body.append(canvas);
  let renderer,author,disposePromise;
  const stages=new Set();
  const stage=(task,adopt)=>{
    const promise=Promise.resolve().then(()=>{controller.signal.throwIfAborted();return task();}).then(value=>{adopt?.(value);return value;});
    stages.add(promise);
    promise.then(()=>stages.delete(promise),()=>stages.delete(promise));
    return promise;
  };
  const dispose=()=>{
    if(disposePromise) return disposePromise;
    controller.abort();
    disposePromise=(async()=>{
      const errors=[];
      // Race failure may stop awaiting a stage, but does not relinquish its
      // owner. The page runtime bounds this wait and never emits a success ack
      // for an unfinished stage. Late resolution still reaches real disposal.
      const settled=await Promise.allSettled([...stages]);
      for(const result of settled) if(result.status==='rejected') errors.push(result.reason);
      try { await author?.dispose?.(); } catch(error) { errors.push(error); }
      try { await assets.dispose(); } catch(error) { errors.push(error); }
      if(renderer) {
        try { renderer.setAnimationLoop(null); } catch(error) { errors.push(error); }
        try { renderer.dispose(); } catch(error) { errors.push(error); }
        try { renderer.forceContextLoss(); } catch(error) { errors.push(error); }
      }
      try { canvas.remove(); } catch(error) { errors.push(error); }
      if(errors.length) throw new AggregateError(errors,'Three particle scene cleanup failed');
    })();
    return disposePromise;
  };
  particles.registerCleanup(dispose);
  const guarded=(task,adopt)=>Promise.race([stage(task,adopt),particles.failure]);
  try {
    renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,preserveDrawingBuffer:true});
    renderer.setPixelRatio(1); renderer.setSize(spec.width,spec.height,false);
    renderer.setClearColor(0x000000,0);
    renderer.outputColorSpace=THREE.SRGBColorSpace;
    renderer.toneMapping=THREE.ACESFilmicToneMapping;
    await guarded(()=>createScene({THREE,assets:assets.api,renderer,frame,inputProps:spec.inputProps??{},signal:controller.signal}),value=>{author=value;});
    if(!author?.scene?.isScene || !author?.camera?.isCamera) throw Error('createScene must return a Three scene and camera');
    if(typeof author.renderFrame==='function') await guarded(()=>author.renderFrame(frame));
    controller.signal.throwIfAborted();
    author.scene.updateMatrixWorld(true); author.camera.updateMatrixWorld(true);
    await particles.runPhase(input=>stage(()=>author.particleFrame(input)));
    await particles.check();
    controller.signal.throwIfAborted();
    renderer.setSize(spec.width,spec.height,false);
    author.scene.updateMatrixWorld(true); author.camera.updateMatrixWorld(true);
    await guarded(()=>renderer.compileAsync(author.scene,author.camera));
    await particles.check();
    renderer.render(author.scene,author.camera);
    const gl=renderer.getContext(); gl.finish();
    if(gl.isContextLost()) throw Error('Three scene lost its WebGL context');
    await particles.check();
  } catch(error) {
    try { await particles.cleanup(); } catch(cleanup) { throw new AggregateError([error,cleanup],'Three particle frame and cleanup failed',{cause:error}); }
    throw error;
  }
}};
`;

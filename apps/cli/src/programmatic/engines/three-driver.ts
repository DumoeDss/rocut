import { THREE_ASSETS_DRIVER } from "./three-assets-driver";

/** A fresh scene per capture, evaluated only at Rust's authoritative integer frame. */
export const THREE_FRAME_DRIVER =
	String.raw`
import * as THREE from 'three';
import {createScene} from 'rocut:entry';
` +
	THREE_ASSETS_DRIVER +
	String.raw`
const spec=window.__rocutThreeSpec;
window.rocut={async renderFrame(frame){
  const controller=new AbortController();
  const assets=createAssets(frame,controller.signal);
  const canvas=document.createElement('canvas');
  canvas.style.cssText='display:block;width:100%;height:100%'; document.body.append(canvas);
  let renderer, author, disposed=false;
  const dispose=()=>{
    if(disposed) return; disposed=true; controller.abort();
    try { author?.dispose?.(); } finally {
      assets.dispose();
      if(renderer) { renderer.setAnimationLoop(null); renderer.dispose(); renderer.forceContextLoss(); }
      canvas.remove();
    }
  };
  addEventListener('pagehide',dispose,{once:true});
  try {
    renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,preserveDrawingBuffer:true});
    renderer.setPixelRatio(1); renderer.setSize(spec.width,spec.height,false);
    renderer.setClearColor(0x000000,0);
    renderer.outputColorSpace=THREE.SRGBColorSpace;
    renderer.toneMapping=THREE.ACESFilmicToneMapping;
    author=await createScene({THREE,assets:assets.api,renderer,frame,inputProps:spec.inputProps??{},signal:controller.signal});
    if(!author?.scene?.isScene || !author?.camera?.isCamera) throw Error('createScene must return a Three scene and camera');
    if(typeof author.renderFrame==='function') await author.renderFrame(frame);
    controller.signal.throwIfAborted();
    renderer.setSize(spec.width,spec.height,false);
    author.scene.updateMatrixWorld(true); author.camera.updateMatrixWorld(true);
    await renderer.compileAsync(author.scene,author.camera);
    controller.signal.throwIfAborted();
    renderer.render(author.scene,author.camera);
    // Capture readiness includes submitted GPU work, not just parsed models.
    const gl=renderer.getContext(); gl.finish();
    if(gl.isContextLost()) throw Error('Three scene lost its WebGL context');
  } catch(error) { dispose(); throw error; }
}};
`;

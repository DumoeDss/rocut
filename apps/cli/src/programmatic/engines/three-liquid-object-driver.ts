import { THREE_PARTICLE_ASSETS_DRIVER } from "./three-assets-driver";

// The Host runtime owns identity, Rust policy, reservations, request codecs and cancellation.
export const THREE_LIQUID_OBJECT_PHASE_DRIVER = String.raw`
async function runLiquidObjectPhase(author,runtime,mappedFrame,signal) {
  signal.throwIfAborted();
  if(typeof runtime?.runPhase!=='function' || typeof runtime.fail!=='function' ||
     typeof runtime.failure?.then!=='function') throw Error('Liquid requires a controlled Host lifecycle');
  const frame=Object.freeze(JSON.parse(JSON.stringify(mappedFrame)));
  if(!Number.isSafeInteger(frame.index) || frame.index<0 || !Number.isFinite(frame.time) ||
     !Number.isInteger(frame.seed) || frame.seed<0 || frame.seed>0xffffffff)
    throw Error('Liquid requires the Rust mapped frame');
  if(typeof author.liquidFrame!=='function') throw Error('Liquid scene requires liquidFrame');
  return runtime.runPhase(async service=>{
    if(!service || typeof service.evaluate!=='function' ||
       service.frame?.index!==frame.index || service.frame?.time!==frame.time || service.frame?.seed!==frame.seed)
      throw Error('Liquid Host phase does not match the Rust mapped frame');
    let active=true,pending=0,terminal,rejectFailure;
    const failure=new Promise((_,reject)=>{rejectFailure=reject;});
    failure.catch(()=>{});
    const fail=error=>{
      if(!terminal) {
        terminal=error instanceof Error?error:Error(String(error));
        rejectFailure(terminal);
        runtime.fail(terminal);
      }
      return terminal;
    };
    const check=()=>{
      signal.throwIfAborted();
      if(terminal) throw terminal;
      if(!active) throw Error('Liquid request is outside liquidFrame');
    };
    const liquid=Object.freeze({deformRest(input){
      const task=(async()=>{
        check();
        if(!input || typeof input!=='object' || Array.isArray(input) ||
           !Object.hasOwn(input,'params') || !Object.hasOwn(input,'positions') ||
           Reflect.ownKeys(input).some(key=>!['params','positions','domain'].includes(key)))
          throw Error('Liquid facade accepts only params, rest positions and optional domain');
        const hasDomain=Object.hasOwn(input,'domain');
        if(hasDomain) {
          const domain=input.domain;
          if(!domain || typeof domain!=='object' || Array.isArray(domain) ||
             Reflect.ownKeys(domain).length!==2 || !Object.hasOwn(domain,'min') || !Object.hasOwn(domain,'max') ||
             ['min','max'].some(key=>!Array.isArray(domain[key]) || domain[key].length!==3 ||
               Reflect.ownKeys(domain[key]).length!==4 ||
               [0,1,2].some(index=>!Object.hasOwn(domain[key],index) ||
                 typeof domain[key][index]!=='number' || !Number.isFinite(domain[key][index]))))
            throw Error('Liquid domain requires only min/max finite three-number arrays');
        }
        // Only this closure supplies mapped time and seed. Host must repeat binding
        // and budget admission before copying/encoding the structured payload.
        const request={version:1,params:input.params,positions:input.positions,
          time:frame.time,seed:frame.seed};
        // Rust alone validates domain bounds and containment. Omission preserves
        // the original payload keys and serialization order exactly.
        if(hasDomain) request.domain=input.domain;
        const result=await service.evaluate(request);
        check();
        if(typeof result!=='string') throw Error('Liquid Host must return Rust JSON text');
        return result;
      })();
      pending++;
      const tracked=task.catch(error=>{throw fail(error);}).finally(()=>{pending--;});
      tracked.catch(()=>{});
      return tracked;
    }});
    const onAbort=()=>fail(signal.reason ?? Error('Liquid phase cancelled'));
    signal.addEventListener('abort',onAbort,{once:true});
    try {
      await Promise.race([Promise.resolve().then(()=>author.liquidFrame({frame,liquid})),failure,runtime.failure]);
      check();
      if(pending) throw fail(Error('Liquid requests still pending when liquidFrame returned'));
    } catch(error) { throw fail(error); }
    finally { active=false; signal.removeEventListener('abort',onAbort); }
  });
}
`;

export const THREE_LIQUID_OBJECT_FRAME_DRIVER =
	String.raw`
import * as THREE from 'three';
import {claimLiquidObjectRuntime} from 'rocut:liquid-runtime';
import {createScene} from 'rocut:entry';
` +
	THREE_PARTICLE_ASSETS_DRIVER +
	THREE_LIQUID_OBJECT_PHASE_DRIVER +
	String.raw`
const spec=window.__rocutThreeSpec;
// This driver-only virtual module must be denied to authored source by the
// opt-in compiler. No window/inputProps evaluator or lifecycle grant exists.
const runtime=claimLiquidObjectRuntime();
window.rocut={async renderFrame(incomingFrame){
  const frame=Object.freeze(JSON.parse(JSON.stringify(incomingFrame)));
  const controller=new AbortController();
  const assets=createAssets(frame,controller.signal);
  const canvas=document.createElement('canvas');
  canvas.style.cssText='display:block;width:100%;height:100%'; document.body.append(canvas);
  let renderer,author,disposePromise;
  const stages=new Set();
  const stage=(task,adopt)=>{
    const promise=Promise.resolve().then(()=>{controller.signal.throwIfAborted();return task();})
      .then(value=>{adopt?.(value);return value;});
    stages.add(promise);
    promise.then(()=>stages.delete(promise),()=>stages.delete(promise));
    return promise;
  };
  const dispose=()=>{
    if(disposePromise) return disposePromise;
    controller.abort();
    disposePromise=(async()=>{
      const errors=[];
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
      if(errors.length) throw new AggregateError(errors,'Liquid scene cleanup failed');
    })();
    return disposePromise;
  };
  runtime.registerCleanup(dispose);
  const guarded=(task,adopt)=>Promise.race([stage(task,adopt),runtime.failure]);
  try {
    renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,preserveDrawingBuffer:true});
    renderer.setPixelRatio(1); renderer.setSize(spec.width,spec.height,false);
    renderer.setClearColor(0x000000,0);
    renderer.outputColorSpace=THREE.SRGBColorSpace;
    renderer.toneMapping=THREE.ACESFilmicToneMapping;
    await guarded(()=>createScene({THREE,assets:assets.api,renderer,frame,inputProps:spec.inputProps??{},signal:controller.signal}),value=>{author=value;});
    if(!author?.scene?.isScene || !author?.camera?.isCamera) throw Error('createScene must return a Three scene and camera');
    if(typeof author.renderFrame==='function') await guarded(()=>author.renderFrame(frame));
    await guarded(()=>runLiquidObjectPhase(author,runtime,frame,controller.signal));
    await runtime.check();
    controller.signal.throwIfAborted();
    author.scene.updateMatrixWorld(true); author.camera.updateMatrixWorld(true);
    await guarded(()=>renderer.compileAsync(author.scene,author.camera));
    await runtime.check();
    controller.signal.throwIfAborted();
    renderer.render(author.scene,author.camera);
    const gl=renderer.getContext(); gl.finish();
    if(gl.isContextLost()) throw Error('Liquid scene lost its WebGL context');
    await runtime.check();
  } catch(error) {
    try { await runtime.cleanup(); } catch(cleanup) {
      throw new AggregateError([error,cleanup],'Liquid frame and cleanup failed',{cause:error});
    }
    throw error;
  }
}};
`;

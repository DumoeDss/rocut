/** Bundled only into the controlled browser scene; never evaluates author code on the Host. */
export const THREE_ASSETS_DRIVER = String.raw`
import {loadModel,loadTexture,loadEnvironment} from '@elftia/three-assets';
import {sha256} from '@noble/hashes/sha2.js';

function createAssets(frame, signal) {
  if (!frame.resourceLimits) throw Error('Three scene requires the Rust resource policy');
  const bridge=window.rocutResources, owned=[], models=new Map(), textures=new Map(), environments=new Map();
  let disposed=false;
  const own=value=>{
    if (disposed || signal.aborted) { value.dispose(); throw new DOMException('Three resources cancelled','AbortError'); }
    owned.push(value); return value;
  };
  const descriptor=(id,kind)=>{
    signal.throwIfAborted();
    const resource=bridge.descriptor(id);
    if(resource.kind!==kind) throw Error('Unexpected resource kind for '+id);
    return {id:resource.id,mediaType:resource.mimeType,byteLength:resource.byteLength,sha256:resource.sha256};
  };
  const options={
    limits:frame.resourceLimits,signal,
    resolver:{async read(id,signal){signal?.throwIfAborted();return bridge.bytes(id);}},
    digestSha256:async bytes=>sha256(new Uint8Array(bytes)).buffer,
  };
  const cached=(map,key,load)=>{
    signal.throwIfAborted();
    if(disposed) throw Error('Three resources disposed');
    if(!map.has(key)) map.set(key,load().then(own));
    return map.get(key);
  };
  const api=Object.freeze({
    async model(id){
      const asset=descriptor(id,'model');
      const model=await cached(models,id,()=>loadModel(asset,options));
      signal.throwIfAborted(); return own(model.createInstance());
    },
    async texture(id,role='color'){
      if(role!=='color' && role!=='data') throw Error('Texture role must be color or data');
      const asset=descriptor(id,'image');
      return cached(textures,id+':'+role,()=>loadTexture(asset,{...options,role}));
    },
    async environment(id){
      const asset=descriptor(id,'environment');
      return cached(environments,id,async()=>{
        const loaded=await loadEnvironment(asset,options);
        // Three r185's equirectangular PMREM has a documented 64x32 minimum.
        if(loaded.value.image.width<64 || loaded.value.image.height<32) {
          loaded.dispose(); throw Error('Three environment lighting requires an image of at least 64x32 pixels');
        }
        return loaded;
      });
    },
  });
  return {api,dispose(){
    if(disposed) return; disposed=true;
    for(const value of owned.reverse()) { try { value.dispose(); } catch {} }
    owned.length=0; models.clear(); textures.clear(); environments.clear();
  }};
}
`;

function replaceAssetsFragment(
	source: string,
	before: string,
	after: string,
): string {
	if (source.split(before).length !== 2)
		throw Error("Three particle assets require the known shared loader layout");
	return source.replace(before, after);
}

// Keep the legacy driver bytes stable. Particle capture changes only lease
// lifecycle handling; model/texture/environment loading still has one source.
const PARTICLE_ASSETS_LIFECYCLE = String.raw`
  let disposed=false, cleanup;
  const operations=new Set(), failures=new Set(), cancellations=new WeakSet();
  const cancelled=()=>{
    const error=new DOMException('Three resources cancelled','AbortError');
    cancellations.add(error); return error;
  };
  const release=async value=>{
    try { await value.dispose(); }
    catch(error) { failures.add(error); throw error; }
  };
  const own=async value=>{
    if(disposed || signal.aborted) { await release(value); throw cancelled(); }
    owned.push(value); return value;
  };
`;
const PARTICLE_ASSETS_DISPOSE = String.raw`
  const strictApi=Object.freeze(Object.fromEntries(Object.entries(api).map(([name,method])=>[
    name,(...args)=>{
      if(disposed || signal.aborted) return Promise.reject(cancelled());
      const operation=method(...args); operations.add(operation);
      void operation.then(()=>operations.delete(operation),error=>{
        operations.delete(operation);
        if(!cancellations.has(error)) failures.add(error);
      });
      return operation;
    }
  ])));
  return {api:strictApi,dispose(){
    return cleanup ??= (async()=>{
      disposed=true;
      // API operations cover post-load instance creation; cache promises cover
      // loading itself. Late own() leases are reclaimed before either settles.
      const pending=[...operations,...models.values(),...textures.values(),...environments.values()];
      const releases=owned.splice(0).reverse().map(release);
      try { await Promise.allSettled([...pending,...releases]); }
      finally { models.clear(); textures.clear(); environments.clear(); operations.clear(); }
      if(failures.size) {
        const errors=[...failures];
        throw new AggregateError(errors,'Three asset lease cleanup failed',{cause:errors[0]});
      }
    })();
  }};
`;

let particleAssets = replaceAssetsFragment(
	THREE_ASSETS_DRIVER,
	String.raw`  let disposed=false;
  const own=value=>{
    if (disposed || signal.aborted) { value.dispose(); throw new DOMException('Three resources cancelled','AbortError'); }
    owned.push(value); return value;
  };
`,
	PARTICLE_ASSETS_LIFECYCLE.slice(1),
);
particleAssets = replaceAssetsFragment(
	particleAssets,
	"          loaded.dispose(); throw Error('Three environment lighting requires an image of at least 64x32 pixels');",
	"          await release(loaded); throw Error('Three environment lighting requires an image of at least 64x32 pixels');",
);
particleAssets = replaceAssetsFragment(
	particleAssets,
	String.raw`  return {api,dispose(){
    if(disposed) return; disposed=true;
    for(const value of owned.reverse()) { try { value.dispose(); } catch {} }
    owned.length=0; models.clear(); textures.clear(); environments.clear();
  }};
`,
	PARTICLE_ASSETS_DISPOSE.slice(1),
);
export const THREE_PARTICLE_ASSETS_DRIVER = particleAssets;

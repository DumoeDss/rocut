/** Browser-only entry for the pinned Remotion runtime. Esbuild bundles this with
 * the declared author entry; no authored React code runs in the compiler host. */
export const REMOTION_FRAME_DRIVER = String.raw`
import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {Internals, delayRender, continueRender, getInputProps} from 'remotion';
import 'rocut:entry';

const spec = window.__rocutRemotionSpec;
const metadataPolicy = window.__rocutRemotionMetadataPolicy;
if (!metadataPolicy || metadataPolicy.spec !== spec || typeof window.__rocutRemotionLifetimeFactory !== 'function')
  throw Error('Remotion compiled metadata policy missing');
const audioAnalysis = window.rocutRemotionAudio?.analysisOnly === true;
const audioHandled = window.rocutRemotionAudio?.enabled === true;
let failure;
class Boundary extends React.Component {
  state = {failed:false};
  static getDerivedStateFromError() { return {failed:true}; }
  componentDidCatch(error) { failure = error; }
  render() { return this.state.failed ? null : this.props.children; }
}
let select;
function Selection() {
  const {setCanvasContent} = React.useContext(Internals.CompositionSetters);
  React.useLayoutEffect(() => { select = setCanvasContent; }, [setCanvasContent]);
  return null;
}
const paint = () => new Promise(resolve => requestAnimationFrame(resolve));
function check(deadline) {
  if (failure) throw failure;
  if (window.remotion_cancelledError) throw Error(String(window.remotion_cancelledError).slice(0,1000));
  if (document.querySelector(audioHandled ? 'iframe,object,embed' : 'audio,iframe,object,embed'))
    throw Error('Remotion media requires an asset adapter; use Rocut tracks');
  window.rocutMedia.check();
  if (performance.now() > deadline) throw Error('Remotion frame readiness timed out');
}
const assets = {renderAssets:[], unregisterRenderAsset:id => {
  if (audioHandled) window.rocutRemotionAudio.unregister(id);
}, registerRenderAsset:asset => {
  if (audioHandled || (!audioAnalysis && asset?.type === 'artifact')) window.rocutRemotionAudio.register(asset);
  else failure = Error('Remotion media/artifact output requires an asset adapter; use Rocut tracks');
}};
window.__rocutRenderRemotionFrame = async (frame, producedScan = null) => {
  if (producedScan && (producedScan.profile !== 'remotion-4.0.440-native-produced-frames-v1'
      || producedScan.canonicalStartFrame !== 0 || producedScan.canonicalEndFrameExclusive !== spec.durationFrames
      || !Array.isArray(producedScan.frames) || producedScan.frames.length !== spec.durationFrames
      || producedScan.frames[0]?.index !== 0 || frame !== producedScan.frames[0]
      || !window.rocutRemotionAudio?.producedSnapshot))
    throw Error('Remotion produced scan requires the full Rust canonical frame descriptors');
  if (frame.frameRate.numerator !== spec.frameRate.numerator || frame.frameRate.denominator !== spec.frameRate.denominator)
    throw Error('Remotion bundle FPS differs from source; recompile');
  let deadline = performance.now() + 8000;
  let lifetime = window.__rocutRemotionLifetimeFactory({timeoutMs:8000,check:()=>check(deadline)});
  const teardown = () => lifetime.abort(Error('Remotion metadata realm torn down'));
  addEventListener('pagehide',teardown,{once:true});
  let root, mount, boot, bootReleased=false, completed=false, failureReason;
  try {
  lifetime.check();
  window.remotion_initialFrame = frame.index;
  boot = delayRender('Rocut composition initialization');
  while (!Internals.getRoot()) { lifetime.check(); await lifetime.wait(paint()); }
  const Root = Internals.getRoot();
  mount = document.createElement('div');
  document.body.appendChild(mount);
  root = createRoot(mount);
  const render = metadata => flushSync(() => root.render(
    <Boundary><Internals.RenderAssetManager.Provider value={assets}><Internals.RemotionRootContexts numberOfAudioTags={0} logLevel="error"
      audioLatencyHint="interactive" videoEnabled={!audioAnalysis || !!producedScan} audioEnabled={true}
      frameState={{[spec.compositionId]:frame.index}} visualModeEnabled={false}>
      <Internals.CompositionManagerProvider onlyRenderComposition={spec.compositionId}
        initialCompositions={[]} initialCanvasContent={null} currentCompositionMetadata={metadata}>
        <Root/><Selection/>
      </Internals.CompositionManagerProvider>
    </Internals.RemotionRootContexts></Internals.RenderAssetManager.Provider></Boundary>
  ));
  render(null);
  let composition;
  while (!(composition = Internals.compositionsRef.current?.getCompositions().find(c => c.id === spec.compositionId))) {
    lifetime.check(); await lifetime.wait(paint());
  }
  const inputProps = getInputProps();
  metadataPolicy.assertInputProps(inputProps);
  const metadata = await lifetime.wait(Internals.resolveVideoConfig({
    compositionId:composition.id, compositionWidth:composition.width, compositionHeight:composition.height,
    compositionFps:composition.fps, compositionDurationInFrames:composition.durationInFrames,
    calculateMetadata:composition.calculateMetadata, signal:lifetime.signal,
    defaultProps:composition.defaultProps ?? {}, inputProps:{...composition.defaultProps, ...inputProps}
  }));
  lifetime.check();
  if (metadata.width !== spec.width || metadata.height !== spec.height || metadata.durationInFrames !== spec.durationFrames
      || Math.abs(metadata.fps - spec.frameRate.numerator / spec.frameRate.denominator) > 1e-8)
    throw Error('Remotion composition metadata differs from compile specification');
  metadataPolicy.assertMetadata({compositionId:composition.id,width:metadata.width,height:metadata.height,
    fps:metadata.fps,durationFrames:metadata.durationInFrames,props:metadata.props});
  const portal = Internals.portalNode();
  // The official portal's default parent is the offscreen Studio staging node.
  // Attach its native composition output to this isolated capture surface.
  document.body.appendChild(portal);
  render(metadata);
  flushSync(() => select({type:'composition', compositionId:spec.compositionId}));
  lifetime.check();
  continueRender(boot);
  bootReleased=true;
  const settle = async () => {
    let stable = 0;
    while (stable < 2) {
      await lifetime.wait(paint()); lifetime.check();
      stable = window.remotion_renderReady && window.remotion_delayRenderHandles.length === 0 ? stable + 1 : 0;
    }
    window.rocutMedia.check(true);lifetime.check();
  };
  await settle();
  if (producedScan) {
    const captures=[];let observationBytes=1024;
    const observationLimit=window.rocutRemotionAudio.maxProducedObservationBytes;
    if(!Number.isSafeInteger(observationLimit)||observationLimit<=0)throw Error('Missing Rust produced frame IO budget');
    const capture=async()=>{
      const item={frameIndex:frame.index,assets:window.rocutRemotionAudio.snapshot(),produced:window.rocutRemotionAudio.producedSnapshot()};
      if(item.produced.some(asset=>asset.type==='artifact' && asset.contentType==='thumbnail')) {
        if(typeof window.rocutRemotionProducedCapture!=='function')throw Error('Remotion thumbnail capture consumer unavailable');
        await lifetime.wait(window.rocutRemotionProducedCapture(frame));lifetime.check();
      }
      observationBytes+=new TextEncoder().encode(JSON.stringify(item)).length+1;
      if(observationBytes>observationLimit)throw Error('Remotion produced canonical capture exceeds the Rust observation byte budget');
      captures.push(item);
    };
    await capture();
    for(let index=1;index<producedScan.frames.length;index++) {
      const next=producedScan.frames[index];
      if(next.index!==index || next.seed!==frame.seed || next.durationFrames!==spec.durationFrames
          || next.frameRate.numerator!==spec.frameRate.numerator || next.frameRate.denominator!==spec.frameRate.denominator)
        throw Error('Remotion produced frame context identity changed');
      lifetime.finish();deadline=performance.now()+8000;
      lifetime=window.__rocutRemotionLifetimeFactory({timeoutMs:8000,check:()=>check(deadline)});
      frame=next;
      // Updating the same native root preserves React state and native asset IDs.
      // The original TimelineContextProvider reads controlled frameState props.
      render(metadata);await settle();await capture();
    }
    completed=true;
    return {version:1,profile:producedScan.profile,frames:captures};
  }
  completed=true;
  } catch(error) {failureReason=error;throw error;}
  finally {
    lifetime.finish();removeEventListener('pagehide',teardown);
    if(!bootReleased && boot!==undefined) {
      try {continueRender(boot);} catch(error) {if(failureReason===undefined) throw error;}
    }
    // A successful capture keeps the native root mounted until realm disposal.
    if(!completed) {try {root?.unmount();} finally {mount?.remove();}}
  }
};
window.__rocutRenderRemotionProducedFrames = scan => window.__rocutRenderRemotionFrame(scan.frames[0],scan);
`;

/** Native TimelineContextProvider consults localStorage even while rendering.
 * Supply a new in-memory Storage per frame, never a browser/user storage grant. */
export const REMOTION_ENVIRONMENT = String.raw`
const values = new Map();
Object.defineProperty(window, 'localStorage', {value:{
  get length() { return values.size; },
  key(index) { return [...values.keys()][index] ?? null; },
  getItem(key) { return values.get(String(key)) ?? null; },
  setItem(key,value) { values.set(String(key),String(value)); },
  removeItem(key) { values.delete(String(key)); }, clear() { values.clear(); }
}});
window.process = {env:{NODE_ENV:'production'}};
window.remotion_puppeteerTimeout = 10000;
window.remotion_attempt = 1;
window.remotion_isPlayer = false;
window.remotion_isStudio = false;
window.remotion_isReadOnlyStudio = false;
window.remotion_audioEnabled = true;
window.remotion_videoEnabled = !window.rocutRemotionAudio?.analysisOnly || !!window.rocutRemotionAudio?.producedEnabled;
window.remotion_staticBase = '';
// Native OffthreadVideo still constructs its proxy URL. Port 0 is an inert
// protocol marker consumed only by the patched native fetch seam, never HTTP.
window.remotion_proxyPort = 0;
`;

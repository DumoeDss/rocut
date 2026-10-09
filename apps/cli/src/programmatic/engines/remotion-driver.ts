/** Browser-only entry for the pinned Remotion runtime. Esbuild bundles this with
 * the declared author entry; no authored React code runs in the compiler host. */
export const REMOTION_FRAME_DRIVER = String.raw`
import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {Internals, delayRender, continueRender, getInputProps} from 'remotion';
import 'rocut:entry';

const spec = window.__rocutRemotionSpec;
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
  if (audioHandled) window.rocutRemotionAudio.register(asset);
  else failure = Error('Remotion media/artifact output requires an asset adapter; use Rocut tracks');
}};
window.__rocutRenderRemotionFrame = async frame => {
  if (frame.frameRate.numerator !== spec.frameRate.numerator || frame.frameRate.denominator !== spec.frameRate.denominator)
    throw Error('Remotion bundle FPS differs from source; recompile');
  const deadline = performance.now() + 8000;
  window.remotion_initialFrame = frame.index;
  const boot = delayRender('Rocut composition initialization');
  while (!Internals.getRoot()) { check(deadline); await paint(); }
  const Root = Internals.getRoot();
  const mount = document.createElement('div');
  document.body.appendChild(mount);
  const root = createRoot(mount);
  const render = metadata => flushSync(() => root.render(
    <Boundary><Internals.RenderAssetManager.Provider value={assets}><Internals.RemotionRootContexts numberOfAudioTags={0} logLevel="error"
      audioLatencyHint="interactive" videoEnabled={!audioAnalysis} audioEnabled={true}
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
    check(deadline); await paint();
  }
  const metadata = await Internals.resolveVideoConfig({
    compositionId:composition.id, compositionWidth:composition.width, compositionHeight:composition.height,
    compositionFps:composition.fps, compositionDurationInFrames:composition.durationInFrames,
    calculateMetadata:composition.calculateMetadata, signal:new AbortController().signal,
    defaultProps:composition.defaultProps ?? {}, inputProps:{...composition.defaultProps, ...getInputProps()}
  });
  check(deadline);
  if (metadata.width !== spec.width || metadata.height !== spec.height || metadata.durationInFrames !== spec.durationFrames
      || Math.abs(metadata.fps - spec.frameRate.numerator / spec.frameRate.denominator) > 1e-8)
    throw Error('Remotion composition metadata differs from compile specification');
  const portal = Internals.portalNode();
  // The official portal's default parent is the offscreen Studio staging node.
  // Attach its native composition output to this isolated capture surface.
  document.body.appendChild(portal);
  render(metadata);
  flushSync(() => select({type:'composition', compositionId:spec.compositionId}));
  check(deadline);
  continueRender(boot);
  let stable = 0;
  while (stable < 2) {
    await paint(); check(deadline);
    stable = window.remotion_renderReady && window.remotion_delayRenderHandles.length === 0 ? stable + 1 : 0;
  }
  window.rocutMedia.check(true);
};
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
window.remotion_videoEnabled = !window.rocutRemotionAudio?.analysisOnly;
window.remotion_staticBase = '';
// Native OffthreadVideo still constructs its proxy URL. Port 0 is an inert
// protocol marker consumed only by the patched native fetch seam, never HTTP.
window.remotion_proxyPort = 0;
`;

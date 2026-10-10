import { canonicalRemotionMetadataJson } from "./remotion-metadata-json";
import { REMOTION_METADATA_LIFETIME_SOURCE } from "./remotion-metadata-lifetime";
/** Separate discovery bundle: strict JSON and bounded metadata use the same
 * adapter helpers as painting, before any structured-clone/JSON transport. */
export const REMOTION_INSPECTION_DRIVER = String.raw`
import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {Internals, getInputProps} from 'remotion';
import 'rocut:entry';
const rocutInspectionCanonicalJson = (${canonicalRemotionMetadataJson.toString()});
${REMOTION_METADATA_LIFETIME_SOURCE}
let failure;
class Boundary extends React.Component {
  state = {failed:false};
  static getDerivedStateFromError() {return {failed:true};}
  componentDidCatch(error) {failure=error;}
  render() {return this.state.failed ? null : this.props.children;}
}
const paint = () => new Promise(resolve => requestAnimationFrame(resolve));
window.__rocutInspectRemotion = async () => {
  const deadline=performance.now()+8000;
  const check=()=>{
    if(failure) throw failure;
    if(window.remotion_cancelledError) throw Error(String(window.remotion_cancelledError).slice(0,1000));
    if(performance.now()>deadline) throw Error('Remotion inspection timed out');
  };
  const lifetime=rocutCreateRemotionMetadataLifetime({timeoutMs:8000,check});
  const teardown=()=>lifetime.abort(Error('Remotion inspection realm torn down'));
  addEventListener('pagehide',teardown,{once:true});
  let root;
  try {
    while(!Internals.getRoot()) {lifetime.check();await lifetime.wait(paint());}
    const Root=Internals.getRoot(), mount=document.createElement('div');
    document.body.appendChild(mount);root=createRoot(mount);
    flushSync(()=>root.render(<Boundary><Internals.RemotionRootContexts numberOfAudioTags={0}
      logLevel="error" audioLatencyHint="interactive" videoEnabled={false} audioEnabled={false}
      frameState={{}} visualModeEnabled={false}>
      <Internals.CompositionManagerProvider initialCompositions={[]} initialCanvasContent={null}
        currentCompositionMetadata={null}><Root/></Internals.CompositionManagerProvider>
    </Internals.RemotionRootContexts></Boundary>));
    let previous='', stable=0, compositions=[];
    while(stable<2 || window.remotion_delayRenderHandles.length) {
      await lifetime.wait(paint());lifetime.check();
      compositions=Internals.compositionsRef.current?.getCompositions() ?? [];
      const ids=JSON.stringify(compositions.map(c=>c.id));
      stable=ids===previous ? stable+1 : 0;previous=ids;
    }
    if(!compositions.length) throw Error('No registered Remotion compositions');
    const results=[];
    for(const c of compositions) {
      const metadata=await lifetime.wait(Internals.resolveVideoConfig({compositionId:c.id,
        compositionWidth:c.width,compositionHeight:c.height,compositionFps:c.fps,
        compositionDurationInFrames:c.durationInFrames,calculateMetadata:c.calculateMetadata,
        signal:lifetime.signal,defaultProps:c.defaultProps ?? {},
        inputProps:{...c.defaultProps,...getInputProps()}}));
      lifetime.check();
      rocutInspectionCanonicalJson(metadata.props);
      results.push({id:c.id,width:metadata.width,height:metadata.height,fps:metadata.fps,
        durationFrames:metadata.durationInFrames,props:metadata.props});
    }
    lifetime.check();rocutInspectionCanonicalJson(results);return results;
  } finally {lifetime.finish();removeEventListener('pagehide',teardown);root?.unmount();}
};
`;

/** Same opaque-origin, no-network grants as frame capture, without frame rendering. */
export function remotionInspectionExpression(code: string): string {
	const csp =
		"default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' data:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data:; connect-src data:; worker-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
	const bootstrap = String.raw`
const failures=[];
addEventListener('error',e=>failures.push(e.message || 'Inspection script failed'),true);
addEventListener('unhandledrejection',()=>failures.push('Inspection promise rejected'));
addEventListener('securitypolicyviolation',()=>failures.push('Inspection external resource denied by CSP'));
addEventListener('DOMContentLoaded',async()=>{
  try {
    await window.rocut.ready;
    const compositions=await window.__rocutInspectRemotion();
    if(failures.length) throw Error(failures[0]);
    parent.postMessage({tag:'rocut-remotion-inspection',compositions},'*');
  } catch(error) {parent.postMessage({tag:'rocut-remotion-inspection',error:String(error).slice(0,1000)},'*');}
});`;
	const document = `<meta http-equiv="Content-Security-Policy" content="${csp}"><script>${bootstrap}</script>${code}`;
	return `new Promise((resolve,reject)=>{
const iframe=document.createElement('iframe');iframe.sandbox='allow-scripts';
addEventListener('message',event=>{
  if(event.source!==iframe.contentWindow || event.data?.tag!=='rocut-remotion-inspection') return;
  if(event.data.error) reject(Error(event.data.error));else resolve(event.data.compositions);
});
iframe.srcdoc=${JSON.stringify(document)};document.body.appendChild(iframe);
})`;
}

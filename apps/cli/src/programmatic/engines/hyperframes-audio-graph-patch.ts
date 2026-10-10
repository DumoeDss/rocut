/** Embedded compiler-child IO hook, pinned to core 0.8.139. Capture the native
 * resolved clip before active-window filtering; the graph bridge owns no clock.
 * Optional while graph collection is gated. This does not enable graph audio.
 */
export const HYPERFRAMES_AUDIO_GRAPH_PATCH = String.raw`
const graphHook = 'let{el:r}=n;if(!r.isConnected)continue;let i=n.rate??n.playbackRate,';
if (patched.split(graphHook).length !== 2)
  throw Error('Pinned HyperFrames audio graph observation hook changed; review the adapter');
patched = patched.replace(graphHook,
  'let{el:r}=n;if(!r.isConnected)continue;window.rocutHyperframesAudioGraph?.collectTrack(r,n,e.timeSeconds);let i=n.rate??n.playbackRate,');
// Preserve the original fade declaration for the independently pinned gain-only
// bridge. H is the native resolved author gain, NOT the authored clip.volume.
const graphGainLocals = 'C=js.get(r),D=$s(r.volume),H,F=rf(r,e.timeSeconds-n.start);';
const graphGainRoute = 'else e.isWebAudioRouted?.(r)?H=E:';
const graphGainFade = 'let I=n.fades??bm;';
const graphGainApplied = 'r.volume=k,js.set(r,k),e.onElementVolume?.(r,k,H),';
for (const shape of [graphGainLocals, graphGainRoute, graphGainFade, graphGainApplied, 'function _s(e,t=Dn)'])
  if (patched.split(shape).length !== 2)
    throw Error('Pinned HyperFrames resolved author-gain hook changed; review the adapter');
patched = patched.replace(graphGainLocals, graphGainLocals.replace('H,F=', 'H,rocutGraphRouted=null,F='));
patched = patched.replace(graphGainRoute, 'else (rocutGraphRouted=!!e.isWebAudioRouted?.(r))?H=E:');
patched = patched.replace(graphGainFade,
  'window.rocutHyperframesAudioGraph?.collectResolvedAuthorGain(r,n,e.timeSeconds,{gainBeforeFades:H,'+
  'source:F!==null?"normalized-volume-lane":n.volumeKeyframes?.length?"normalized-GSAP":"fallback",'+
  'points:F!==null?_s(r.getAttribute(kt)||"")?.points??[]:n.volumeKeyframes?.length?n.volumeKeyframes.map(p=>({t:p.time,v:p.volume})):null,'+
  'fades:n.fades??bm,fallback:F!==null||n.volumeKeyframes?.length?null:{routed:rocutGraphRouted,previousRuntimeVolume:C??null,currentElementVolume:D,baselineGain:E}});'+graphGainFade);
patched = patched.replace(graphGainApplied,
  'r.volume=k,js.set(r,k),window.rocutHyperframesAudioGraph?.collectAppliedAuthorGain(r,n,e.timeSeconds,H,k),e.onElementVolume?.(r,k,H),');
`;

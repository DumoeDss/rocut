import React, { useContext, useEffect } from 'react';
import { Audio, Html5Audio, Html5Video, OffthreadVideo, Composition, Internals, Sequence, registerRoot, staticFile } from 'remotion';
import tone from './tone.wav';
import video from './frames.webm';

function BadAsset() {
  const manager = useContext(Internals.RenderAssetManager);
  useEffect(() => { try { manager.registerRenderAsset({ type: 'artifact', id: 'invalid' } as never); } catch {} }, [manager]);
  return null;
}
function Scene({ mode }: { mode: string }) {
  if (mode === 'runaway') { while (true) {} }
  if (mode === 'artifact') return <BadAsset/>;
  if (mode === 'corrupt') return <Audio src="data:audio/wav;base64,AQID"/>;
  if (mode === 'remote') return <Audio src="https://example.invalid/audio.wav"/>;
  if (mode === 'raw') return <audio src={tone}/>;
  if (mode === 'offthread' || mode === 'video') {
    const Component = mode === 'offthread' ? OffthreadVideo : Html5Video;
    return <Sequence from={5} durationInFrames={20} layout="none">
      <Component src={video} trimBefore={6} playbackRate={2} volume={0.4} toneFrequency={1.25} audioStreamIndex={1}/>
    </Sequence>;
  }
  return <>
    <Sequence from={3} durationInFrames={24} layout="none">
      <Sequence from={2} durationInFrames={20} layout="none">
        <Audio src={tone} trimBefore={6} playbackRate={2} volume={f => 0.1 + f / 100}/>
      </Sequence>
    </Sequence>
    <Html5Audio src={tone} loop trimBefore={12} trimAfter={20} volume={f => 0.2 + f / 1000}/>
    <Html5Audio src={staticFile('other.wav')} loop trimBefore={12} trimAfter={20}
      loopVolumeCurveBehavior="extend" volume={f => 0.3 + f / 1000}/>
    <Audio src={tone} muted/>
    <Audio src={tone} volume={0}/>
  </>;
}
registerRoot(() => <Composition id="AudioProbe" component={Scene} durationInFrames={60}
  width={64} height={64} fps={30} defaultProps={{ mode: 'mix' }}/>);

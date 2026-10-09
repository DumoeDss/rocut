import React from 'react';
import { AbsoluteFill, Audio, Composition, registerRoot, useCurrentFrame } from 'remotion';
import tone from './editor.wav';

function Scene() {
  const frame = useCurrentFrame();
  return <AbsoluteFill style={{ background: `rgb(${frame * 40},${255 - frame * 20},0)` }}>
    <Audio src={tone} volume={0.5}/>
  </AbsoluteFill>;
}
registerRoot(() => <Composition id="EditorAudio" component={Scene} durationInFrames={6} width={64} height={64} fps={30}/>);

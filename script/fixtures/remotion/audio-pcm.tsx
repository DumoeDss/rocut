import React from 'react';
import { Audio, Composition, Sequence, registerRoot } from 'remotion';
import tone from './tone.wav';
import other from './other.wav';

function Scene({ mode }: { mode: string }) {
  if (mode === 'loop') return <Audio src={tone} loop trimBefore={6} trimAfter={8} volume={f => 0.25 + f / 4}/>;
  if (mode === 'fractional') return <Sequence from={2} layout="none"><Audio src={tone} trimBefore={6}/></Sequence>;
  return <>
    <Sequence from={2} durationInFrames={3} layout="none">
      <Audio src={tone} trimBefore={6} volume={f => 0.25 + f / 4}/>
    </Sequence>
    <Sequence from={3} durationInFrames={1} layout="none">
      <Audio src={other} trimBefore={3} volume={0.5}/>
    </Sequence>
  </>;
}
registerRoot(() => <>
  <Composition id="AudioPcm" component={Scene} durationInFrames={60}
    width={64} height={64} fps={30} defaultProps={{ mode: 'mix' }}/>
  <Composition id="Fractional" component={Scene} durationInFrames={60}
    width={64} height={64} fps={30000 / 1001} defaultProps={{ mode: 'fractional' }}/>
</>);

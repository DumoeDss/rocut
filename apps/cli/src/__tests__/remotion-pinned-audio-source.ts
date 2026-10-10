import { nativeAudioWav } from "../../../../script/fixtures/native-audio-fixture";

export type PinnedAudioMode = "stable" | "props-drift" | "geometry-drift";
export const PINNED_AUDIO_INPUT = Object.freeze({
	w: 80,
	h: 48,
	length: 36,
	start: 5,
	trim: 7,
	rate: 2,
	gain: 0.3,
});
export const PINNED_AUDIO_RETURNED = Object.freeze({
	...PINNED_AUDIO_INPUT,
	offset: 9,
	resolvedGain: 0.4,
});
export const PINNED_AUDIO_SEEKS = [12, 4, 5, 8, 13, 6, 0, 12] as const;

/** Known non-silent source; no codec process, user media, network or microphone. */
export function pinnedAudioWave() {
	return nativeAudioWav({
		seconds: 2,
		sample: (index, channel) =>
			Math.sin((index * 480 * Math.PI * 2) / 48000) * (channel ? -0.2 : 0.4),
	});
}

/** Native Remotion owns Sequence/trim/rate/volume. Drift occurs only in the
 * genuine native-audio analysis realm, after two stable inspection passes. */
export function pinnedAudioAuthor(mode: PinnedAudioMode) {
	return `import React from 'react';
import {Audio,Composition,Sequence,registerRoot} from 'remotion';
import tone from './tone.wav';
const calculateMetadata=async({props})=>{
  if(props.offset!==undefined||props.resolvedGain!==undefined)throw Error('returned props substituted into inputProps');
  const analysis=window.rocutRemotionAudio?.analysisOnly===true;
  const resolvedGain=props.gain+0.1+(analysis&&${JSON.stringify(mode)}==='props-drift'?0.25:0);
  return {width:props.w+(analysis&&${JSON.stringify(mode)}==='geometry-drift'?1:0),height:props.h,
    durationInFrames:props.length,props:analysis?{resolvedGain,offset:props.trim+2,...props}:{...props,offset:props.trim+2,resolvedGain}};
};
const Scene=props=><Sequence from={props.start} durationInFrames={8} layout="none">
  <Audio src={tone} trimBefore={props.offset} playbackRate={props.rate} volume={frame=>props.resolvedGain+frame/100}/>
</Sequence>;
registerRoot(()=><Composition id="Rocut" component={Scene} width={64} height={64} fps={30} durationInFrames={60}
  defaultProps={{w:64,h:64,length:60,start:1,trim:2,rate:1,gain:0.05}} calculateMetadata={calculateMetadata}/>);`;
}

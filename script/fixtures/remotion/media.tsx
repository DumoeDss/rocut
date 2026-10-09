import React from 'react';
import { Html5Video, Loop, OffthreadVideo, Sequence, Video, staticFile } from 'remotion';
import clip from '../assets/frames.webm';

const style = {position:'absolute' as const,width:64,height:32,left:0};
export function MediaScene({mode, resourceId}: {mode: string; resourceId?: string}) {
  if (mode === 'offthread') return <OffthreadVideo src={clip} muted/>;
  if (mode === 'offthread-corrupt-video') return <OffthreadVideo src="data:video/webm;base64,AQID" muted/>;
  if (mode === 'offthread-audible-video') return <OffthreadVideo src={clip}/>;
  if (mode === 'corrupt-video') return <Html5Video src="data:video/webm;base64,AAAA" muted/>;
  if (mode === 'audible-video') return <Html5Video src={clip}/>;
  if (mode === 'raw-video') return <video src={clip} muted/>;
  const publicVideo = resourceId ? window.rocutResources.url(resourceId) : staticFile('frames.webm');
  if (mode === 'hdr-video') return <>
    <OffthreadVideo src={publicVideo} muted transparent style={{...style,top:0}}/>
    <OffthreadVideo src={publicVideo} muted transparent toneMapped={false} style={{...style,top:32}}/>
  </>;
  if (mode === 'offthread-video') {
    const imageOnly = (image: HTMLImageElement) => {
      if (!(image instanceof HTMLImageElement)) throw Error('Offthread rendering must return an image, never Html5Video');
    };
    return <>
      <Sequence from={3} durationInFrames={24} layout="none">
        <Sequence from={2} durationInFrames={20} layout="none">
          <OffthreadVideo src={clip} muted trimBefore={6} playbackRate={2} style={{...style,top:0}} onVideoFrame={imageOnly}/>
        </Sequence>
      </Sequence>
      <Loop durationInFrames={8} layout="none">
        <OffthreadVideo src={publicVideo} muted trimBefore={12} trimAfter={20} style={{...style,top:32}} onVideoFrame={imageOnly}/>
      </Loop>
    </>;
  }
  return <>
    <Sequence from={3} durationInFrames={24} layout="none">
      <Sequence from={2} durationInFrames={20} layout="none">
        <Html5Video src={clip} muted trimBefore={6} playbackRate={2} style={{...style,top:0}}/>
      </Sequence>
    </Sequence>
    <Video src={publicVideo} muted loop trimBefore={12} trimAfter={20} style={{...style,top:32}}/>
  </>;
}

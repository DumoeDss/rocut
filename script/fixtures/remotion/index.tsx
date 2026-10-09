import React from 'react';
import { Audio, Composition, Folder, Img, Sequence, registerRoot, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import pixel from '../assets/pixel.png';
import './style.css';
import { MediaScene } from './media';

const Delayed = React.lazy(() => import('./delayed'));
const block = (left: number, top: number, color: string, width = 16) =>
  ({position:'absolute' as const,left,top,width,height:16,background:color});
const Local = ({child = false}) => <div style={block(useCurrentFrame() * 2, child ? 32 : 0, child ? '#00ff00' : 'rgba(255,0,0,.5)')}/>;
function Scene(props: {color: string; resolved: boolean; mode?: string; resourceId?: string}) {
  const frame = useCurrentFrame(), video = useVideoConfig();
  const context = document.createElement('canvas').getContext('2d')!;
  context.font = '20px "Rocut Remotion Fixture"';
  const fontReady = [...document.fonts].some(face => face.family.includes('Rocut Remotion Fixture') && face.status === 'loaded')
    && Math.abs(context.measureText('iiii').width - context.measureText('WWWW').width) < .01;
  if (props.mode === 'throw') throw Error('intentional-remotion-error');
  if (props.mode === 'video' || props.mode?.endsWith('-video') || props.mode === 'offthread')
    return <MediaScene mode={props.mode} resourceId={props.resourceId}/>;
  return <>
    <Sequence from={15} durationInFrames={30} layout="none">
      <Local/><Sequence from={8} durationInFrames={8} layout="none"><Local child/></Sequence>
    </Sequence>
    <div style={{...block(frame / 2,56,'#0000ff',8),height:8}}/>
    <Img src={pixel} style={{position:'absolute',left:40,top:48,width:8,height:8}}/>
    <Img src={staticFile('pixel.png')} style={{position:'absolute',left:48,top:48,width:8,height:8}}/>
    <div style={{...block(56,48,fontReady && props.resolved && video.width === 64 && props.color === '#00ff00' ? '#00ff00' : '#ff0000',8),height:8}}/>
    <Delayed mode={props.mode}/>
    {props.mode === 'media' ? <video src="data:video/mp4;base64,AAAA"/> : null}
    {props.mode === 'audio' ? <Audio src="data:audio/wav;base64,AAAA"/> : null}
  </>;
}
registerRoot(() => <Folder name="diagnostics">
  <Composition id="Wrong" component={() => <div style={{background:'red',width:64,height:64}}/>} width={64} height={64} fps={30} durationInFrames={60}/>
  <Composition id="Rocut" component={Scene} width={64} height={64} fps={30} durationInFrames={60}
    defaultProps={{color:'#ff0000',resolved:false}}
    calculateMetadata={async ({props}) => ({props:{...props,resolved:true}})}/>
</Folder>);

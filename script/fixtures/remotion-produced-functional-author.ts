/** Real Remotion components and native asset-manager writes, not mocked Host IO.
 * @remotion/media decoding is deliberately outside this installed-toolchain smoke. */
export const REMOTION_PRODUCED_FUNCTIONAL_AUTHOR=String.raw`
import React,{useContext,useLayoutEffect,useRef,useState} from 'react';
import {Composition,registerRoot,Internals,Artifact,Sequence,useCurrentFrame,delayRender} from 'remotion';
function Scene({stall=false}:{stall?:boolean}) {
  const frame=useCurrentFrame();
  const manager=useContext(Internals.RenderAssetManager);
  const [id]=useState(()=>String(Math.random()));
  const visits=useRef(0),last=useRef(-1);
  if(last.current!==frame){last.current=frame;visits.current++;}
  useLayoutEffect(()=>{
    if(stall){delayRender('functional cancellation gate');return;}
    // Frame zero writes the complete source; later canonical frames overwrite
    // their regions under the same native ID. Placement ignores timestamp.
    const count=frame===0?12800:1600,audio=new Int16Array(count*2);
    audio.fill((frame+1)*1000);
    manager.registerRenderAsset({type:'inline-audio',id,audio,frame,timestamp:-123,
      duration:count/48000*1e6,toneFrequency:1});
    return ()=>manager.unregisterRenderAsset(id);
  },[frame,id,manager,stall]);
  return <div style={{width:64,height:32,background:'rgb(20,80,140)',color:'white'}}>
    native frame {frame}
    <Artifact filename={'history/frame-'+frame+'.json'} content={JSON.stringify({frame,id,visits:visits.current})}/>
    <Artifact filename="empty.bin" content={new Uint8Array(0)}/>
    <Artifact filename="whitespace.txt" content={' \n\t'}/>
    <Sequence from={2} durationInFrames={1}>
      <Artifact filename="frame-two.png" content={Artifact.Thumbnail}/>
    </Sequence>
  </div>;
}
registerRoot(()=> <Composition id="ProducedFunctional" component={Scene} width={64} height={32}
  fps={30} durationInFrames={8} defaultProps={{stall:false}}/>);
`;

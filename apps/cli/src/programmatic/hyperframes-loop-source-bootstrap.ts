/** oR is the unchanged native buffer-start helper in core 0.8.139, Apache-2.0.
 * Source bundle SHA-256 f01e9f5b5a4cb7e5211dc417ce9d9350e8d27d33cd1e2a0f272d4bd3425b06e3.
 * Rust emits every exact elapsed/offset/duration; this realm executes native
 * scheduling/decoding only. It does not quantize a repeated tile or derive rate.
 */
export const HYPERFRAMES_LOOP_SOURCE_BOOTSTRAP = String.raw`
(() => {
  function oR(e,t){let{elapsed:n,mediaStart:r,scheduledAt:i,globalRate:o,mediaRate:a,clipDuration:s}=t,l=Number.isFinite(s)&&s>0,u=s*a;if(n>=0){let d=n*a,m=u-d;return l&&m<=0?!1:(l?e.start(0,d+r,m):e.start(0,d+r),!0)}let f=-n/o;return l?e.start(i+f,r,u):e.start(i+f,r),!0}
  const NativeOfflineAudioContext = window.OfflineAudioContext;
  let phase='new', plan, encoded, uploaded=0, output, nodes=[];
  const fail=message=>{phase='failed';throw Error(message);};
  const live=()=>{if(phase==='disposed'||phase==='failed')throw Error('Native loop source disposed');};
  const integer=value=>Number.isSafeInteger(value)&&value>=0;
  const cleanup=()=>{for(const node of nodes){try{node.stop();}catch{}node.disconnect();}nodes=[];encoded=output=plan=null;};
  Object.defineProperty(window,'rocutNativeLoopSourceIO',{value:Object.freeze({
    configure(value,byteLength){
      if(phase!=='new'||!integer(byteLength)||byteLength<1||value.profile!=='hyperframes-0.8.139-native-buffer-loop-clock-v1'
        ||value.sampleRate!==48000||!integer(value.outputFrames)||value.outputFrames<1
        ||!integer(value.maxSourceFrames)||value.maxSourceFrames<1||!Array.isArray(value.segments)
        ||value.segments.length<1||value.segments.length>16384)fail('Invalid native source-loop receipt');
      plan=value;encoded=new Uint8Array(byteLength);phase='uploading';
    },
    put(offset,base64){
      if(phase!=='uploading'||offset!==uploaded||typeof base64!=='string'||base64.length>87384)fail('Invalid native loop upload');
      const bytes=atob(base64);
      if(!bytes.length||bytes.length>65536||uploaded+bytes.length>encoded.length)fail('Excessive native loop upload');
      for(let i=0;i<bytes.length;i++)encoded[uploaded+i]=bytes.charCodeAt(i);uploaded+=bytes.length;
    },
    async render(){
      if(phase!=='uploading'||uploaded!==encoded.length)fail('Incomplete native loop source');
      phase='rendering';
      const context=new NativeOfflineAudioContext(2,plan.outputFrames,48000);
      let source=await context.decodeAudioData(encoded.buffer);live();encoded=null;
      if(source.sampleRate!==48000||source.length>plan.maxSourceFrames||source.numberOfChannels<1||source.numberOfChannels>64)
        fail('Native decoded source exceeds admitted geometry');
      // Canonical source extension duplicates mono into stereo, as its original
      // explicit pan filter does. Native stereo/multichannel mixing stays native.
      if(source.numberOfChannels===1){const stereo=context.createBuffer(2,source.length,48000);
        stereo.copyToChannel(source.getChannelData(0),0);stereo.copyToChannel(source.getChannelData(0),1);source=stereo;}
      for(const segment of plan.segments){
        live();const node=context.createBufferSource();node.buffer=source;node.playbackRate.value=1;
        node.connect(context.destination);nodes.push(node);
        if(!oR(node,{elapsed:segment.elapsedSeconds,mediaStart:segment.mediaStartSeconds,scheduledAt:0,
          globalRate:1,mediaRate:1,clipDuration:segment.durationSeconds}))fail('Native loop segment was not scheduled');
      }
      const rendered=await context.startRendering();live();output=rendered;
      if(output.length!==plan.outputFrames||output.numberOfChannels!==2)fail('Native loop output geometry mismatch');
      phase='ready';return {frames:output.length,bytes:output.length*8};
    },
    read(offset,count){
      if(phase!=='ready'||!integer(offset)||!integer(count)||!count||offset%8||count%8||count>65536||offset+count>output.length*8)
        fail('Invalid native loop PCM transfer');
      const bytes=new Uint8Array(count),view=new DataView(bytes.buffer);
      for(let byte=0;byte<count;byte+=8){const frame=(offset+byte)/8;
        for(let channel=0;channel<2;channel++){const value=output.getChannelData(channel)[frame];
          if(!Number.isFinite(value))fail('Nonfinite native loop PCM');view.setFloat32(byte+channel*4,value,true);}}
      let binary='';for(let byte=0;byte<count;byte+=8192)binary+=String.fromCharCode(...bytes.subarray(byte,Math.min(byte+8192,count)));
      return btoa(binary);
    },
    dispose(){phase='disposed';cleanup();}
  })});
})();
`;

import React from 'react';
import {useDelayRender} from 'remotion';

export default function Delayed({mode}: {mode?:string}) {
  const {delayRender,continueRender,cancelRender} = useDelayRender();
  const [handle] = React.useState(() => delayRender('diagnostic asynchronous state'));
  const [ready,setReady] = React.useState(false);
  React.useEffect(() => {
    if (mode === 'stall') return;
    const timer = setTimeout(() => {
      if (mode === 'cancel') { cancelRender(Error('intentional-remotion-cancel')); return; }
      setReady(true); continueRender(handle);
    }, 40);
    return () => clearTimeout(timer);
  }, [handle,mode,continueRender,cancelRender]);
  return <div style={{position:'absolute',left:48,top:0,width:16,height:16,background:ready ? '#00ffff' : '#ff0000'}}/>;
}

/** Diagnostic-only iterator scheduling; native commands/primitives are unchanged. */
export const HEART_SPRITE_READBACK_CONTROL_SOURCE = String.raw`
function heartControlledCharReadback({body,command,preparedImage,original,originalBody,pixels,diff,make}) {
  if(!command)return {available:false,reason:'No Char command in the actual frame'};
  for(const surface of [body,command]) {
    if(surface.commands.some(c=>['surface','appendSurface','releaseSurface'].includes(c.kind)))
      throw Error('Controlled readback requires flat surface child commands');
  }
  const experiments=[];
  for(const order of [['publishOnly','perYield'],['perYield','publishOnly']]) {
    const allocated=[],counts={publishOnly:0,perYield:0,body:0};
    const sink=make(1,1), snapshots={};
    const arms=order.map((mode,index)=>({...command,id:'heart-diagnostic-char-'+index}));
    const iterator=drawMvEmberSteps(sink.getContext('2d'),{commands:[body,...arms]},{preparedImage},(w,h)=>{
      const c=make(w,h);allocated.push(c);return c;
    });
    let yields=0;
    const advance=()=>{const step=iterator.next();if(step.done)throw Error('Controlled iterator ended before publish boundary');yields++;};
    try {
      // drawMvEmberSteps yields once after each child, then once after
      // scratch.set(id,surface). No readback occurs during body preparation.
      for(let n=0;n<body.commands.length+1;n++)advance();
      if(allocated.length!==1)throw Error('Controlled body publication allocation mismatch');
      const bodyPublishYield=yields,charPublishYields=[];
      for(const [index,mode] of order.entries()) {
        for(let n=0;n<command.commands.length+1;n++) {
          advance();
          if(mode==='perYield') {
            snapshots[mode]=pixels(allocated[index+1]);counts[mode]++;
          }
        }
        if(allocated.length!==index+2)throw Error('Controlled Char publication allocation mismatch');
        charPublishYields.push(yields);
        if(mode==='publishOnly') {
          snapshots[mode]=pixels(allocated[index+1]);counts[mode]++;
        }
      }
      // Read body only after both Char arms have consumed this same live canvas.
      const bodyBytes=pixels(allocated[0]);counts.body++;
      const expected=pixels(original);
      experiments.push({order,sharedNativeBody:true,noBodyReadBeforeBothChars:true,
        bodyPublishYield,charPublishYields,readCounts:counts,
        publishOnlyVsOriginal:diff(snapshots.publishOnly,expected),
        perYieldVsOriginal:diff(snapshots.perYield,expected),
        publishOnlyVsPerYield:diff(snapshots.publishOnly,snapshots.perYield),
        bodyRgbaBytes:bodyBytes.length,bodyDifference:diff(bodyBytes,pixels(originalBody))});
    } finally {
      iterator.return();sink.width=sink.height=1;
    }
  }
  return {available:true,shard:0,variant:'char',scope:'same native prepared-image handle and one unread live body per counterbalanced pair; no causal conclusion about acceptance realm',experiments};
}
`;

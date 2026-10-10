export function glassPixelDifference(a,b,width,height) {
 if(a.length!==b.length||a.length!==width*height*4)throw Error("Exact RGBA dimensions required");
 let sum=0,changed=0,count=0;
 for(let y=Math.floor(height*0.43);y<Math.ceil(height*0.57);y++)for(let x=Math.floor(width*0.45);x<Math.ceil(width*0.55);x++) {
  const p=(y*width+x)*4;let delta=0;
  for(let c=0;c<3;c++)delta+=Math.abs(a[p+c]-b[p+c]);
  sum+=delta;count+=3;if(delta>6)changed++;
 }
 return {mean:sum/count,changed,pixels:count/3};
}
export function acceptGlassGpu(metrics) {
 for(const name of ["backgroundTransmission","roughness","thickness","ior","motion"])
  if(!(metrics[name].mean>1&&metrics[name].changed>20))throw Error(`Optical gate ${name} failed: ${JSON.stringify(metrics[name])}`);
 if(metrics.backgroundOpaque.mean>0.05)throw Error("Opaque negative control responds to backdrop inside model ROI");
 if(metrics.reverseSeek.mean!==0||metrics.reverseSeek.changed!==0)throw Error("Reverse seek pixels differ");
 return true;
}

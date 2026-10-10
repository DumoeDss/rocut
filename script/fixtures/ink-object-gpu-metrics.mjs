export function inkPixelDifference(a,b,width,height,region="center") {
 if(a.length!==b.length||a.length!==width*height*4)throw Error("Exact RGBA dimensions required");
 let sum=0,changed=0,count=0;
 const limits=region==="center"?[0.4,0.6,0.35,0.65]:[0.25,0.75,0.15,0.85];
 for(let y=Math.floor(height*limits[2]);y<Math.ceil(height*limits[3]);y++)for(let x=Math.floor(width*limits[0]);x<Math.ceil(width*limits[1]);x++) {
  const p=(y*width+x)*4;let delta=0;for(let c=0;c<3;c++)delta+=Math.abs(a[p+c]-b[p+c]);sum+=delta;count+=3;if(delta>6)changed++;
 }return {mean:sum/count,changed,pixels:count/3};
}
export function acceptInkGpu(metrics) {
 for(const name of ["inkColor","density","paperTexture","paperScale","seed","map","normalMap","motion"])
  if(!(metrics[name].mean>0.5&&metrics[name].changed>20))throw Error(`Ink pixel gate ${name} failed: ${JSON.stringify(metrics[name])}`);
 if(!(metrics.contour.mean>0.1&&metrics.contour.changed>60))throw Error("Contour ring did not change");
 if(metrics.reverseSeek.mean!==0||metrics.reverseSeek.changed!==0)throw Error("Ink reverse seek differs");
 return true;
}

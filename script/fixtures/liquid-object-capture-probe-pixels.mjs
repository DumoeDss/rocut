import assert from 'node:assert/strict';
import {inflateSync} from 'node:zlib';
export function pngPixels(png){
 assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
 let offset=8,width,height,channels;const chunks=[];
 while(offset<png.length){const size=png.readUInt32BE(offset),tag=png.toString('ascii',offset+4,offset+8),data=png.subarray(offset+8,offset+8+size);
  if(tag==='IHDR'){width=data.readUInt32BE(0);height=data.readUInt32BE(4);assert.equal(data[8],8);channels=data[9]===6?4:data[9]===2?3:0;assert(channels);assert.equal(data[12],0);}
  if(tag==='IDAT')chunks.push(data);offset+=size+12;
 }
 const raw=inflateSync(Buffer.concat(chunks)),stride=width*channels,pixels=Buffer.alloc(width*height*4),rows=[];
 for(let y=0;y<height;y++){const filter=raw[y*(stride+1)],row=Buffer.alloc(stride),previous=rows[y-1];assert(filter<=4);
  for(let x=0;x<stride;x++){const a=x>=channels?row[x-channels]:0,b=previous?.[x]??0,c=x>=channels?(previous?.[x-channels]??0):0;
   const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);
   const prediction=filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):pa<=pb&&pa<=pc?a:pb<=pc?b:c;
   row[x]=(raw[y*(stride+1)+1+x]+prediction)&255;
  }
  rows.push(row);for(let x=0;x<width;x++){const i=(y*width+x)*4;for(let c=0;c<3;c++)pixels[i+c]=row[x*channels+c];pixels[i+3]=channels===4?row[x*channels+3]:255;}
 }
 return {width,height,pixels};
}
export function pixelComparison({a,b}){
 assert.equal(a.pixels.length,b.pixels.length);let sum=0,changedPixels=0;
 for(let i=0;i<a.pixels.length;i+=4){let changed=false;for(let c=0;c<3;c++){const delta=Math.abs(a.pixels[i+c]-b.pixels[i+c]);sum+=delta;if(delta>2)changed=true;}if(changed)changedPixels++;}
 return {mean:sum/(a.width*a.height*3),changedPixels,totalPixels:a.width*a.height};
}
export function visibility(image){
 const background=image.pixels.subarray(0,3);let changedPixels=0;
 for(let i=0;i<image.pixels.length;i+=4)if([0,1,2].some(c=>Math.abs(image.pixels[i+c]-background[c])>5))changedPixels++;
 return {background:[...background],changedPixels,totalPixels:image.width*image.height};
}

import {deflateSync} from "node:zlib";
import {glassObjectGpuAssets} from "./glass-object-gpu-assets";

function png(normal:boolean) {
 const size=32,rows=Buffer.alloc(size*(size*4+1));
 for(let y=0;y<size;y++)for(let x=0;x<size;x++) {
  const p=y*(size*4+1)+1+x*4;
  const color=normal?((x>>3)%2?[16,16,192]:[240,240,192]):(((x>>2)+(y>>2))%2?[35,75,110]:[230,200,150]);
  for(let c=0;c<3;c++)rows[p+c]=color[c];rows[p+3]=255;
 }
 const chunk=(name:string,bytes:Buffer)=>{const data=Buffer.concat([Buffer.from(name),bytes]),out=Buffer.alloc(bytes.length+12);out.writeUInt32BE(bytes.length);out.write(name,4);bytes.copy(out,8);let crc=0xffffffff;for(const value of data){crc^=value;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}out.writeUInt32BE((crc^0xffffffff)>>>0,out.length-4);return out;};
 const header=Buffer.alloc(13);header.writeUInt32BE(size);header.writeUInt32BE(size,4);header[8]=8;header[9]=6;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",header),chunk("IDAT",deflateSync(rows)),chunk("IEND",Buffer.alloc(0))]);
}
export function inkObjectGpuAssets(THREE:any) {
 const source=glassObjectGpuAssets(THREE),glb=source[0].body;
 const length=glb.readUInt32LE(12),json=JSON.parse(glb.subarray(20,20+length).toString("utf8"));
 const parts=[Buffer.from(glb.subarray(28+length))];let offset=parts[0].length;
 json.images=[];json.textures=[];json.samplers=[{magFilter:9728,minFilter:9987}];
 for(const [index,normal] of [false,true].entries()) {
  const image=png(normal),bufferView=json.bufferViews.length;
  json.bufferViews.push({buffer:0,byteOffset:offset,byteLength:image.length});
  json.images.push({bufferView,mimeType:"image/png"});json.textures.push({sampler:0,source:index});
  const padded=Buffer.alloc(Math.ceil(image.length/4)*4);image.copy(padded);parts.push(padded);offset+=padded.length;
 }
 json.buffers[0].byteLength=offset;json.materials[0].pbrMetallicRoughness.baseColorTexture={index:0};json.materials[0].normalTexture={index:1,scale:0.8};
 const binary=Buffer.concat(parts),text=Buffer.from(JSON.stringify(json)),jsonBytes=Buffer.alloc(Math.ceil(text.length/4)*4,32);text.copy(jsonBytes);
 const u32=(value:number)=>{const bytes=Buffer.alloc(4);bytes.writeUInt32LE(value);return bytes;};
 const body=Buffer.concat([u32(0x46546c67),u32(2),u32(28+jsonBytes.length+binary.length),u32(jsonBytes.length),u32(0x4e4f534a),jsonBytes,u32(binary.length),u32(0x004e4942),binary]);
 return [{id:"ink-model.glb",kind:"model",mimeType:"model/gltf-binary",body},{...source[1],id:"ink-environment.hdr"}];
}

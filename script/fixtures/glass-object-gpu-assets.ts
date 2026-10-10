import { deflateSync } from "node:zlib";
import { threeEnvironment } from "./three-assets";

function chunk(name: string, bytes: Buffer) {
 const data=Buffer.concat([Buffer.from(name),bytes]),out=Buffer.alloc(bytes.length+12);
 out.writeUInt32BE(bytes.length);out.write(name,4);bytes.copy(out,8);
 let crc=0xffffffff;for(const value of data){crc^=value;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
 out.writeUInt32BE((crc^0xffffffff)>>>0,out.length-4);return out;
}
function backdrop(light: boolean) {
 const width=128,height=128,rows=Buffer.alloc(height*(width*4+1));
 for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
  const index=y*(width*4+1)+1+x*4,checker=((x>>3)+(y>>3))%2;
  const colors=light?[[245,225,80],[40,200,245]]:[[30,15,45],[5,50,80]];
  for(let c=0;c<3;c++)rows[index+c]=colors[checker][c];rows[index+3]=255;
 }
 const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",header),chunk("IDAT",deflateSync(rows)),chunk("IEND",Buffer.alloc(0))]);
}
function model(THREE: any) {
 const geometry=new THREE.SphereGeometry(0.8,32,16);
 const arrays=[geometry.attributes.position.array,geometry.attributes.normal.array,geometry.attributes.uv.array,geometry.index.array];
 const parts=arrays.map(value=>Buffer.from(value.buffer,value.byteOffset,value.byteLength));let offset=0;
 const views=parts.map(bytes=>{const view={buffer:0,byteOffset:offset,byteLength:bytes.length};offset+=bytes.length;return view;});
 const binary=Buffer.concat(parts),padded=Buffer.alloc(Math.ceil(binary.length/4)*4);binary.copy(padded);
 const json={asset:{version:"2.0",generator:"Glass optical GPU diagnostic"},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0,scale:[0.9,1.1,0.6]}],buffers:[{byteLength:binary.length}],bufferViews:views,accessors:[{bufferView:0,componentType:5126,count:arrays[0].length/3,type:"VEC3",min:[-0.8,-0.8,-0.8],max:[0.8,0.8,0.8]},{bufferView:1,componentType:5126,count:arrays[1].length/3,type:"VEC3"},{bufferView:2,componentType:5126,count:arrays[2].length/2,type:"VEC2"},{bufferView:3,componentType:5123,count:arrays[3].length,type:"SCALAR"}],meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:1,TEXCOORD_0:2},indices:3,material:0}]}],materials:[{pbrMetallicRoughness:{baseColorFactor:[1,1,1,1],metallicFactor:0,roughnessFactor:0.1}}]};
 const text=Buffer.from(JSON.stringify(json)),jsonBytes=Buffer.alloc(Math.ceil(text.length/4)*4,32);text.copy(jsonBytes);
 const u32=(value:number)=>{const bytes=Buffer.alloc(4);bytes.writeUInt32LE(value);return bytes;};geometry.dispose();
 return Buffer.concat([u32(0x46546c67),u32(2),u32(28+jsonBytes.length+padded.length),u32(jsonBytes.length),u32(0x4e4f534a),jsonBytes,u32(padded.length),u32(0x004e4942),padded]);
}
export function glassObjectGpuAssets(THREE: any) {
 return [{id:"optical-model.glb",kind:"model",mimeType:"model/gltf-binary",body:model(THREE)},{id:"optical-environment.hdr",kind:"environment",mimeType:"image/vnd.radiance",body:threeEnvironment(false,64,32)},{id:"optical-dark.png",kind:"image",mimeType:"image/png",body:backdrop(false)},{id:"optical-light.png",kind:"image",mimeType:"image/png",body:backdrop(true)}];
}

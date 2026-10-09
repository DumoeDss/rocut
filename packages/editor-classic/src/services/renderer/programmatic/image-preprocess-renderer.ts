/** Binary side-channel parser and identity Canvas mechanism. No de-flame or
 * feathering math lives here; the following Rust commands own the feather. */
import { IMAGE_PREPROCESS_IDENTITY_SOURCE } from "./image-preprocess-identity";
export const IMAGE_PREPROCESS_RENDERER_SOURCE = String.raw`
${IMAGE_PREPROCESS_IDENTITY_SOURCE}
function createMvPreparedPatches(patches) {
  const prepared=new Map();
  for(const patch of patches) {
    if(!patch||typeof patch.patchKey!=='string'||prepared.has(patch.patchKey)||!(patch.envelope instanceof Uint8Array))throw Error('Invalid binary preprocessing patch');
    const bytes=patch.envelope;
    if(bytes.byteLength<4)throw Error('Missing preprocessing patch header');
    const n=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(0,true);
    if(n<1||n>4096||n+4>bytes.byteLength)throw Error('Invalid preprocessing patch header');
    const header=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(4,4+n)));
    const {binding,roi}=header;
    if(!binding||!roi||Object.keys(header).length!==2||!sameMvImageIdentity(binding.resource,binding.resource)
      ||binding.algorithm!=='flame-deflame-v1'||![binding.width,binding.height,roi.x,roi.y,roi.width,roi.height].every(Number.isSafeInteger)
      ||binding.width<1||binding.height<1||roi.x<0||roi.y<0||roi.width<1||roi.height<1
      ||roi.x+roi.width>binding.width||roi.y+roi.height>binding.height||bytes.byteLength!==4+n+roi.width*roi.height*4)throw Error('Invalid preprocessing patch binding/ROI');
    prepared.set(patch.patchKey,{header,rgba:bytes.subarray(4+n)});
  }
  return (command,target)=>{
    const patch=prepared.get(command.patchKey);
    if(!patch||!sameMvPreprocessStructure({left:patch.header,right:command.request}))throw Error('Preprocessing patch identity/ROI mismatch');
    const {binding,roi}=command.request;
    if(target.canvas.width!==binding.width||target.canvas.height!==binding.height)throw Error('Preprocessing patch target dimensions mismatch');
    const rgba=new Uint8ClampedArray(patch.rgba);
    target.setTransform(1,0,0,1,0,0);
    target.putImageData(new ImageData(rgba,roi.width,roi.height),roi.x,roi.y);
  };
}
`;

/** Browser transport guards only. Rust remains policy/admission/math authority. */
export const LIQUID_OBJECT_BROWSER_CODEC = String.raw`
const config=JSON.parse(JSON.stringify(window.__rocutLiquidObjectConfig));
const shape=(value,keys)=>{
  if(!value || typeof value!=='object' || Array.isArray(value) ||
     Object.keys(value).length!==keys.length || keys.some(key=>!Object.hasOwn(value,key)))
    throw Error('Invalid Liquid browser transport shape');
  return value;
};
shape(config,['version','frame','policy']);
const policyKeys=['version','maxControlJsonBytes','maxVerticesPerRequest','maxRequestJsonBytes',
 'maxResponseJsonBytes','maxRequestEnvelopeBytes','maxResponseEnvelopeBytes','maxMeshesPerFrame',
 'maxVerticesPerFrame','maxRequestsPerFrame','maxEncodedBytesPerFrame','maxRetainedPayloadBytesPerFrame',
 'maxInFlight','requestTimeoutMs','frameTimeoutMs','cleanupTimeoutMs','initTimeoutMs','terminationTimeoutMs'];
const policy=Object.freeze(shape(config.policy,policyKeys));
if(config.version!==1 || policy.version!==1 || policyKeys.some(key=>key!=='version' &&
 (!Number.isSafeInteger(policy[key]) || policy[key]<=0))) throw Error('Invalid Liquid browser policy');
const frame=Object.freeze(shape(config.frame,['sessionId','index','time','seed']));
if(typeof frame.sessionId!=='string' || !Number.isSafeInteger(frame.index) || frame.index<0 ||
 !Number.isFinite(frame.time) || !Number.isInteger(frame.seed) || frame.seed<0 || frame.seed>0xffffffff)
 throw Error('Invalid Liquid browser frame');
const bytes=text=>new TextEncoder().encode(text).byteLength;
const bounded=(text,maximum)=>{
 if(typeof text!=='string' || bytes(text)>maximum) throw Error('Liquid browser UTF-8 limit exceeded');
 return text;
};
const sameFrame=value=>{
 shape(value,['sessionId','index','time','seed']);
 return Object.keys(frame).every(key=>value[key]===frame[key]);
};
const prepare=(input,requestId)=>{
 const hasDomain=Object.hasOwn(input,'domain');
 shape(input,hasDomain?['version','params','positions','time','seed','domain']:['version','params','positions','time','seed']);
 if(Reflect.ownKeys(input).length!==(hasDomain?6:5)) throw Error('Invalid Liquid browser transport shape');
 if(hasDomain) {
  const domain=shape(input.domain,['min','max']);
  if(Reflect.ownKeys(domain).length!==2 || ['min','max'].some(key=>
   !Array.isArray(domain[key]) || domain[key].length!==3 || Reflect.ownKeys(domain[key]).length!==4 ||
   [0,1,2].some(index=>!Object.hasOwn(domain[key],index) ||
    typeof domain[key][index]!=='number' || !Number.isFinite(domain[key][index]))))
   throw Error('Invalid Liquid browser domain shape');
 }
 if(input.version!==1 || input.time!==frame.time || input.seed!==frame.seed ||
  !Array.isArray(input.positions) || input.positions.length%3 ||
  input.positions.length/3>policy.maxVerticesPerRequest)
   throw Error('Liquid browser request frame/vertex limit mismatch');
 // Check vertex count before allocating JSON. No deformation/parameter normalization here.
 const payloadJson=bounded(JSON.stringify(input),policy.maxRequestJsonBytes);
 const identity={frame,requestId};
 const json=bounded(JSON.stringify({version:1,identity,payloadJson}),policy.maxRequestEnvelopeBytes);
 return {json,identity,vertices:input.positions.length/3};
};
const decode=(text,expected)=>{
 const reply=shape(JSON.parse(bounded(text,expected.operation ? policy.maxControlJsonBytes :
  policy.maxResponseEnvelopeBytes)),expected.operation ? ['operation','frame','ok'] : ['version','identity','payloadJson']);
 if(expected.operation) {
  if(reply.operation!==expected.operation || reply.ok!==true || !sameFrame(reply.frame))
   throw Error('Liquid browser control reply mismatch');
  return;
 }
 const identity=shape(reply.identity,['frame','requestId']);
 if(reply.version!==1 || identity.requestId!==expected.identity.requestId || !sameFrame(identity.frame))
  throw Error('Liquid browser reply identity mismatch');
 const payload=bounded(reply.payloadJson,policy.maxResponseJsonBytes);
 const result=JSON.parse(payload);
 if(result.version!==1 || result.ok!==true || !result.frame || typeof result.frame.restore!=='boolean' ||
  !Array.isArray(result.frame.positions) || result.frame.positions.length!==expected.vertices*3 ||
  result.frame.positions.some(value=>typeof value!=='number' || !Number.isFinite(value)))
   throw Error('Liquid browser malformed Rust result');
 return payload;
};
`;

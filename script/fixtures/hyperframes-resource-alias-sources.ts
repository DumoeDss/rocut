/** Authored browser-only fixture. The compiler may parse but never execute it. */
export const HYPERFRAMES_RESOURCE_ALIAS_PROBE = String.raw`
const aliasRoot=globalThis, AliasURL=aliasRoot.URL, {URL:DestructuredURL}=globalThis;
const aliasMeta=import.meta, {url:aliasBase}=aliasMeta, aliasBaseAgain=aliasBase;
const aliasPicture=new AliasURL('../assets/pixel.png',aliasBaseAgain);
const aliasExtracted=new DestructuredURL('../assets/pixel.png',import.meta['url']);
const aliasGlobal=new globalThis['URL']('../assets/pixel.png',aliasMeta.url);
const aliasImage=new Image(); aliasImage.src=aliasPicture.href; await aliasImage.decode();
const aliasFontURL=new AliasURL('../assets/font.ttf',aliasBase);
const aliasFace=await new FontFace('AliasedModuleFont','url('+aliasFontURL.href+')').load();
document.fonts.add(aliasFace);
const aliasOrder=[];
Object.defineProperty(aliasMeta,'url',{get(){aliasOrder.push('base-expression');return originalBase;}});
const aliasInput={toString(){aliasOrder.push('convert-input');return '../assets/pixel.png';}};
const aliasOrdered=new AliasURL((aliasOrder.push('input-expression'),aliasInput),aliasMeta.url);
const aliasOrderResult=[...aliasOrder];
Object.defineProperty(aliasMeta,'url',{get(){return originalBase;}});
const aliasDenied=[];
for(const name of ['../missing.png','../../../escape.png','https://example.invalid/no.png']) {
  try {new DestructuredURL(name,aliasBase);aliasDenied.push(false);} catch {aliasDenied.push(true);}
}
const aliasModuleDenied=[];
for(const value of [aliasPicture,aliasFontURL]) {
  try {await import(value);aliasModuleDenied.push(false);} catch {aliasModuleDenied.push(true);}
}
const aliasShadow=(function(AliasURL){const Other=AliasURL;return new Other('./local-only.png',aliasBase);})(class LocalURL {constructor(input){this.input=input;}});
const globalAliasShadow=(function(globalThis){const {URL:Local}=globalThis;return new Local('./global-local-only.png',aliasBase);})({URL:class LocalURL {constructor(input){this.input=input;}}});
const aliasURLDescriptor=Object.getOwnPropertyDescriptor(globalThis,'URL'),aliasCustomOrder=[];
let aliasCustomArguments,aliasNonConstructorEffects=0;
try {
  Object.defineProperty(globalThis,'URL',{configurable:true,get(){aliasCustomOrder.push('callee');return class CustomURL {
    constructor(...args){aliasCustomOrder.push('construct');aliasCustomArguments=args;}
  };}});
  new aliasRoot.URL((aliasCustomOrder.push('input'),'./custom-undeclared.png'),aliasBase);
  const CustomAlias=aliasRoot.URL;
  new CustomAlias('./aliased-custom-undeclared.png',aliasBase);
  Object.defineProperty(globalThis,'URL',{configurable:true,value:null});
  try {new aliasRoot.URL((aliasNonConstructorEffects++,'./unused.png'),aliasBase);}catch{}
} finally {Object.defineProperty(globalThis,'URL',aliasURLDescriptor);}
globalThis.__resourceAliasResult={
  picture:aliasPicture.href,extracted:aliasExtracted.href,global:aliasGlobal.href,ordered:aliasOrdered.href,
  width:aliasImage.naturalWidth,height:aliasImage.naturalHeight,fontStatus:aliasFace.status,
  native:AliasURL===originalURL&&DestructuredURL===originalURL&&aliasPicture.constructor===originalURL&&Object.getPrototypeOf(aliasPicture)===originalURL.prototype,
  nativeStatic:AliasURL.createObjectURL===blobFactory,
  order:aliasOrderResult,denied:aliasDenied,moduleDenied:aliasModuleDenied,
  localInput:aliasShadow.input,globalLocalInput:globalAliasShadow.input,
  customOrder:aliasCustomOrder,customArguments:aliasCustomArguments,customBase:aliasBase,nonConstructorEffects:aliasNonConstructorEffects
};
`;

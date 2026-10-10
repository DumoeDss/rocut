/** Installed only by the trusted opt-in compiler after worker/archive admission. */
export const THREE_LIQUID_OBJECT_COMPILER_MODULES = String.raw`
function installLiquidObjectCompilerModules(api,{driver,runtime,project}) {
  if(typeof driver!=='string' || typeof runtime!=='string' || typeof project!=='string')
    throw Error('Liquid compiler requires Host-owned sources');
  const driverNamespace='rocut-liquid-object-driver';
  const runtimeNamespace='rocut-liquid-object-runtime';
  const driverId='rocut:liquid-driver',runtimeId='rocut:liquid-runtime';
  api.onResolve({filter:/^rocut:liquid-(driver|runtime)$/},args=>{
    if(args.path===driverId) {
      if(args.kind!=='entry-point' || args.importer!=='')
        throw Error('Liquid driver is a private compiler entry');
      return {path:driverId,namespace:driverNamespace};
    }
    if(args.namespace!==driverNamespace || args.importer!==driverId || args.kind!=='import-statement')
      throw Error('Liquid runtime is available only to the generated driver');
    return {path:runtimeId,namespace:runtimeNamespace};
  });
  api.onLoad({filter:/.*/,namespace:driverNamespace},args=>{
    if(args.path!==driverId) throw Error('Unexpected Liquid driver module');
    return {contents:driver,loader:'js',resolveDir:project};
  });
  api.onLoad({filter:/.*/,namespace:runtimeNamespace},args=>{
    if(args.path!==runtimeId) throw Error('Unexpected Liquid runtime module');
    return {contents:runtime,loader:'js',resolveDir:project};
  });
}
`;

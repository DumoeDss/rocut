// classic's shipped TypeScript source imports `culori`, which publishes no
// declaration files. In-repo consumers are covered by ambient declarations
// under `packages/*/src/types`; a from-tarballs consumer meets the gap head-on
// (P6 report finding F-P6-3) and must declare the module itself. The adapter
// never calls culori — it only rides classic's migration-chain closure — so an
// untyped shorthand declaration is the honest shape here.
declare module "culori";

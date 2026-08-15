/**
 * @opencutSurface provider — Classic's storage conformance harnesses; the provider's own published test rig
 */
// Declared entry "./storage/conformance" (design E1/E4). See BOUNDARIES.md
// for the full entry-mapping table.
//
// Split out of "./storage" (S05 P1 task 8.5 finding): these five modules are
// conformance/probe harness code, not part of BrowserProjectStore's
// production surface. See the comment in `./index.ts` for why they were
// removed from the general barrel — this narrow entry is their only
// supported import path now.
export * from "../services/storage/browser-project-store-conformance";
export * from "../services/storage/browser-project-store-cascade-probes";
export * from "../services/storage/browser-project-store-cascade-round2-probes";
export * from "../services/storage/browser-project-store-migration-round2-probes";
export * from "../services/storage/browser-project-store-residual-probes";

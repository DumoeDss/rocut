// Declared entry "./media" (design E1/E4). Declared but currently
// unconsumed outside the package — left in place per E4 (P2's Electron
// Host is the likely first consumer). This directory mirrors
// apps/web/src/media/**; this barrel re-exports its full surface, the same
// pattern src/timeline/index.ts already established. See BOUNDARIES.md for
// the full entry-mapping table.
export * from "./audio";
export * from "./audio-mastering";
export * from "./mediabunny";
export * from "./media-utils";
export * from "./persistence";
export * from "./processing";
export * from "./thumbnail";
export * from "./types";
export * from "./upload-toast";
export * from "./use-file-upload";
export * from "./use-paste-media";
export * from "./waveform-summary";

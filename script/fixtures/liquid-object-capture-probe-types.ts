import type { ProgrammaticSource, ProgrammaticResource } from "@opencut/editor-contracts";
export interface ProcessObservation { executable: string; pid?: number; kind: string; closed: boolean; code?: number | null; signal?: string | null }
export interface ProbeOptions { root: string; creator: string; threeToolchain: string; executable: string; observe?(): ProcessObservation[] }
export interface CompiledProbe { source: ProgrammaticSource; code: string }
export interface LiquidCreator {
 liquidObjectThree(options: { sourceDirectory: string; model: ProgrammaticResource;
  settings: { width: number; height: number; durationFrames: number; frameRate: { numerator: number; denominator: number }; seed: number };
  liquid: { amount: number; frequency: number; speed: number; twist: number }; resolveParams(json: string): string }): Promise<{ spec: unknown }>;
}
export interface PixelMetric { mean: number; changedPixels: number; totalPixels: number }
export interface ProbeReport {
 ok: boolean; stage: string; root: string; scope: string;
 captures: { name: string; mappedFrame: unknown; path: string; bytes: number; sha256: string; elapsedMs: number;
  captureReturnedAfterProductionPageCleanupBrokerDisposeAndBrowserClose: boolean; observedProcesses?: ProcessObservation[];
  visibility: { background: number[]; changedPixels: number; totalPixels: number } }[];
 compiled: { name: string; source: ProgrammaticSource; archive: unknown; documentBytes: number; documentSha256: string }[];
 stage1?: string; parameterSensitivity?: PixelMetric; motionSensitivity?: PixelMetric; reverseSeek?: PixelMetric;
 attachments?: { key: string; bytes: number; sha256: string }[]; failure?: ErrorReceipt;
}
export interface ErrorReceipt { name: string; message: string; stack?: string; causes?: ErrorReceipt[] }
export function errorReceipt(error: unknown): ErrorReceipt {
 return error instanceof Error ? { name: error.name, message: error.message, stack: error.stack,
  ...(error instanceof AggregateError ? { causes: error.errors.map(errorReceipt) } : {}) } : { name: "UnknownError", message: String(error) };
}

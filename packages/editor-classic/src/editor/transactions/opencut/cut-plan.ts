import type { MusicGridSourceAvailabilityProbe, TransactionRead } from "@opencut/editor-contracts";
import { captureMusicGridDocument, musicGridNativeFunction, verifyMusicGridSources } from "./music-grid";
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** Read-only speculative plan validation. Rust owns all mapping/coverage rules;
 * Creator independently authenticates proposed fixed media before any author mutation. */
export async function validateCutPlan({ engine, request, sourceAvailability }: {
  engine: TransactionRead;
  request: unknown;
  sourceAvailability?: MusicGridSourceAvailabilityProbe;
}): Promise<Record<string, unknown>> {
  const validate = musicGridNativeFunction("validateCutPlanJson");
  if (!validate) return {status: "unavailable", reason: "Native cut-plan validation is unavailable"};
  const result: unknown = JSON.parse(validate(JSON.stringify({document: await captureMusicGridDocument(engine), request})));
  if (!isRecord(result)) throw Error("Invalid Native cut-plan validation");
  return verifyMusicGridSources({engine, result, sourceAvailability});
}

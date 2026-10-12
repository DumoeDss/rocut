import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const read = (name) => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(fs.readFileSync(path.join(root, "docs/evidence", name))));

export function classifyFiniteBlaze({ authorArtifactsVerified, videoArtifactsVerified, nativePngVerified, historicalCanvasRedPreserved, missingLineagePreserved }) {
  if (!historicalCanvasRedPreserved || !missingLineagePreserved)
    throw new Error("Historical red and missing lineage must remain explicit.");
  return {
    finiteEffectVEligible: authorArtifactsVerified && videoArtifactsVerified,
    nativePngSubsetAccepted: nativePngVerified,
    videoMasterRepairProven: false,
    ledgerRecommendation: authorArtifactsVerified && videoArtifactsVerified ? "V_BOUNDED_HISTORICAL_AUTHOR_VIDEO_ONLY" : "N_FINITE_EFFECT_V_NOT_ESTABLISHED",
  };
}

function pin(record, category) {
  const exists = fs.existsSync(record.path);
  const observedSha256 = exists ? sha(fs.readFileSync(record.path)) : null;
  return { category, path: record.path, expectedSha256: record.sha256, observedSha256, exists, matches: exists && observedSha256 === record.sha256 };
}
function directRecords(value, rows = []) {
  if (!value || typeof value !== "object") return rows;
  if (typeof value.path === "string" && /^[a-f0-9]{64}$/.test(value.sha256 ?? "")) rows.push(value);
  for (const child of Object.values(value)) directRecords(child, rows);
  return rows;
}

export function auditBlazeFiniteScope() {
  const historicalNames = ["blaze-ui-calibration.json", "blaze-editor-export.json", "blaze-production-pipeline.json", "blaze-gpu-host.json"];
  const historical = historicalNames.flatMap((name) => directRecords(read(name)).map((record) => pin(record, name)));
  const native = read("native-frame-png-current.json"), current = read("blaze-current-channel-closure.json");
  const live = [
    pin({ path: native.producer.receipt, sha256: native.producer.receiptSha256 }, "typedNormalProducer"),
    pin({ path: native.gpu.receipt, sha256: native.gpu.receiptSha256 }, "normalDimensionsAndNestedGroup"),
    pin({ path: native.frozenBlazeWholeGraphAndSave.receipt, sha256: native.frozenBlazeWholeGraphAndSave.receiptSha256 }, "frozenBlazeWholeGraphAndActualSave"),
    pin({ path: native.apiReview.actualReviewReceipt, sha256: native.apiReview.actualReviewReceiptSha256 }, "actualTypeReview"),
    pin(current.host.readOnlyReopen.receipt, "boundedHostReadOnlyReopen"),
    pin(current.nativePngProductionRepair.actualNativePngAcceptance.receipt, "singleEffectNativePng"),
    pin(current.nativePngProductionRepair.actualNativePngAcceptance.independentDecode, "singleEffectIndependentDecode"),
  ];
  const author = historical.filter((row) => row.category === "blaze-ui-calibration.json" || row.category === "blaze-editor-export.json");
  const video = historical.filter((row) => row.category === "blaze-editor-export.json" || row.category === "blaze-production-pipeline.json");
  const verdict = classifyFiniteBlaze({
    authorArtifactsVerified: author.length > 0 && author.every((row) => row.matches),
    videoArtifactsVerified: video.length > 0 && video.every((row) => row.matches),
    nativePngVerified: live.filter((row) => row.category !== "boundedHostReadOnlyReopen").every((row) => row.matches),
    historicalCanvasRedPreserved: native.retainedRed.originalCanvasRawGatePassed === false && native.retainedRed.reclassified === false,
    missingLineagePreserved: current.history.missingArtifacts.every((record) => record.exists === false),
  });
  return {
    status: "FINITE_SCOPE_AUDIT_COMPLETE_NOT_AN_EXPORT_OR_RENDER",
    ...verdict,
    directlyRehashedExistingArtifacts: [...historical, ...live].filter((row) => row.exists).length,
    directHistoricalArtifactsMissing: historical.filter((row) => !row.exists).length,
    changedExistingDirectArtifacts: [...historical, ...live].filter((row) => row.exists && !row.matches).length,
    historical,
    live,
    qualification: "Only direct referenced executed artifacts are rehashed; no transitive lineage recovery, new GPU/build, or PNG-to-video inference. Source summaries are not replacement executed evidence.",
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(JSON.stringify(auditBlazeFiniteScope(), null, 2));

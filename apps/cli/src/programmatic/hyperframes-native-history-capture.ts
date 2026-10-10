/** Rust supplies complete frame objects, including fractional discovery clocks.
 * This transport must never reconstruct a native timeline from picture indices.
 */
export interface HyperframesNativeHistoryScan {
	profile: "hyperframes-native-sync-all-author-writes-v1";
	canonicalStart: number;
	canonicalEnd: number;
	times: number[];
	frames: Record<string, unknown>[];
}

export interface HyperframesNativeHistoryCapture {
	scan: HyperframesNativeHistoryScan;
	observationTimes: number[];
}

export interface HyperframesNativeHistoryResult {
	observations: unknown[];
	fallbackHistories: unknown[];
}

/** Same authored realm, consecutive native render calls, actual post-fade writes.
 * Only discovery snapshots are retained; canonical-FPS snapshots are not faders.
 */
export const HYPERFRAMES_NATIVE_HISTORY_CAPTURE = String.raw`
async function captureHyperframesNativeHistory(author, random) {
  const capture = audioAnalysis.hyperframesNativeHistory;
  const graph = window.rocutHyperframesAudioGraph;
  if (audioAnalysis.engine !== 'hyperframes' || !audioAnalysis.hyperframesGraph
      || typeof author?.renderFrame !== 'function'
      || typeof graph?.beginNativeHistory !== 'function' || typeof graph?.endNativeHistory !== 'function')
    throw Error('Native HyperFrames history requires its compiled graph driver');
  const {scan, observationTimes} = capture;
  if (!Array.isArray(scan.frames) || scan.frames.length !== scan.times.length)
    throw Error('Native history lacks Rust-mapped frame objects');
  const wanted = new Set(observationTimes), found = new Set(), observations = [];
  graph.beginNativeHistory(scan);
  for (const mapped of scan.frames) {
    // The original compiled driver invokes bridge.begin exactly once. Calling
    // it here as well would corrupt the canonical scan cursor.
    await author.renderFrame({...mapped, random});
    checkHtmlMedia(true);
    if (failures.length) throw Error(failures[0]);
    if (wanted.has(mapped.time)) {
      observations.push(nativeAudioBridge.snapshot());
      found.add(mapped.time);
    }
  }
  const fallbackHistories = graph.endNativeHistory();
  if (found.size !== wanted.size) throw Error('Native history omitted a discovery observation');
  return {observations, fallbackHistories};
}
`;

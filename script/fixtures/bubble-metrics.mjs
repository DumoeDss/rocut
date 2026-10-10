export const BUBBLE_NATIVE_GATES = Object.freeze({
  premultipliedRgbMean: .5,
  premultipliedRgbMaximum: 4,
  alphaMean: .35,
  alphaMaximum: 3,
  straightRgbMeanAtBothAlphaAtLeast16: 1.5,
  straightRgbMaximumAtBothAlphaAtLeast16: 8,
});
export function compareBubbleRgba(actual, expected) {
  if (!actual || actual.length !== expected?.length || actual.length === 0 || actual.length % 4 !== 0) throw new RangeError('RGBA lengths must match and be nonempty');
  const pixels = actual.length / 4;
  let premul = 0, premulMax = 0, alpha = 0, alphaMax = 0, straight = 0, straightMax = 0, straightChannels = 0, changedBytes = 0;
  for (let offset = 0; offset < actual.length; offset += 4) {
    const a = actual[offset + 3], e = expected[offset + 3], alphaError = Math.abs(a - e);
    alpha += alphaError; alphaMax = Math.max(alphaMax, alphaError);
    for (let channel = 0; channel < 4; channel++) if (actual[offset + channel] !== expected[offset + channel]) changedBytes++;
    for (let channel = 0; channel < 3; channel++) {
      const error = Math.abs(actual[offset + channel] * a - expected[offset + channel] * e) / 255;
      premul += error; premulMax = Math.max(premulMax, error);
      // The mask is exactly both alpha >= 16. No edge/low-alpha/coverage exclusions.
      if (a >= 16 && e >= 16) {
        const difference = Math.abs(actual[offset + channel] - expected[offset + channel]);
        straight += difference; straightMax = Math.max(straightMax, difference); straightChannels++;
      }
    }
  }
  return {
    pixels, changedBytes, straightComparedPixels: straightChannels / 3,
    premultipliedRgbMean: premul / (pixels * 3), premultipliedRgbMaximum: premulMax,
    alphaMean: alpha / pixels, alphaMaximum: alphaMax,
    straightRgbMeanAtBothAlphaAtLeast16: straightChannels ? straight / straightChannels : 0,
    straightRgbMaximumAtBothAlphaAtLeast16: straightMax,
  };
}
export function assessBubbleNative(metrics) {
  const failures = Object.entries(BUBBLE_NATIVE_GATES)
    .filter(([key, limit]) => !Number.isFinite(metrics[key]) || metrics[key] > limit)
    .map(([key, limit]) => ({ key, actual: metrics[key], limit }));
  return { ok: failures.length === 0, failures };
}
export function reportBubbleReadbacks({ referenceRgba, nativeRgba, canvasRgba }) {
  const nativeMetrics = compareBubbleRgba(nativeRgba, referenceRgba);
  const canvasMetrics = compareBubbleRgba(canvasRgba, referenceRgba);
  return {
    nativeTexture: { metrics: nativeMetrics, ...assessBubbleNative(nativeMetrics) },
    canvasPresentation: { metrics: canvasMetrics, comparisonToNativeLimits: assessBubbleNative(canvasMetrics) },
    sameCallNativeVersusCanvas: compareBubbleRgba(canvasRgba, nativeRgba),
  };
}

import { renderBubbleOracle, bubbleFieldAt } from './bubble-oracle.mjs';
import { bubbleCentersAt, bubblePointerAt } from './bubble-oracle-time.mjs';
import { BUBBLE_BASE_SCHEDULE } from './bubble-cases.mjs';
import { compareBubbleRgba, assessBubbleNative } from './bubble-metrics.mjs';

export const BUBBLE_NEGATIVE_CONTROLS = Object.freeze([
  ['no-effect', 'geometry-trail24-blend14'], ['single-head', 'geometry-trail24-blend14'],
  ['radial-head-normal', 'geometry-trail24-blend14'], ['source-independent-overlay', 'geometry-trail24-blend14'],
  ['repeated-first-frame', 'geometry-trail24-blend14'], ['wrong-source-trim-phase', 'geometry-trail24-blend14'],
  ['turning-single-head', 'path-turning'], ['suppress-dispersion', 'input-gray-dispersion'],
  ['suppress-frost', 'input-gray-frost'], ['straight-alpha', 'input-holes-poison'], ['force-opaque', 'input-holes-poison'],
  ['edge-clamp', 'input-saturated-border'], ['suppress-shine', 'decoration-shine'], ['suppress-rim', 'decoration-rim'],
  ['suppress-iridescence', 'decoration-iridescence'], ['suppress-tint', 'decoration-tint'], ['freeze-sheen-time', 'decoration-iridescence'],
].map(([id, caseId]) => Object.freeze({ id, caseId, kind: 'pixel' })).concat([
  'unnormalized-field', 'frame-count-trail-delay', 'mutable-frame-follow',
].map(id => Object.freeze({ id, caseId: null, kind: 'exact-invariant' }))));

function mutantPixels(id, fixture, source) {
  const changed = (changes, mutant) => renderBubbleOracle({ ...fixture, ...changes }, source, mutant).rgba;
  if (id === 'no-effect') return new Uint8Array(source);
  if (id === 'turning-single-head') return changed({}, 'single-head');
  if (['single-head', 'radial-head-normal', 'source-independent-overlay', 'straight-alpha', 'edge-clamp'].includes(id)) return changed({}, id);
  if (id === 'repeated-first-frame') return changed({ ticks: 0 });
  if (id === 'wrong-source-trim-phase') return changed({ ticks: fixture.ticks + 16016 });
  if (id === 'freeze-sheen-time') return changed({ ticks: 80080 });
  if (id === 'force-opaque') {
    const rgba = changed({}); for (let index = 3; index < rgba.length; index += 4) rgba[index] = 255; return rgba;
  }
  const control = id === 'suppress-tint' ? 'tintStrength' : id.replace('suppress-', '');
  return changed({ params: { ...fixture.params, [control]: 0 } });
}
export function bubbleNegativesForCase(fixture, canonicalRgba, referenceRgba) {
  const controls = BUBBLE_NEGATIVE_CONTROLS.filter(control => control.caseId === fixture.id);
  if (!controls.length) return [];
  const reference = referenceRgba ?? renderBubbleOracle(fixture, canonicalRgba).rgba;
  return controls.map(({ id }) => {
    const mutantRgba = mutantPixels(id, fixture, canonicalRgba), metrics = compareBubbleRgba(mutantRgba, reference);
    const assessment = assessBubbleNative(metrics);
    return { id, caseId: fixture.id, kind: 'pixel', mutantRgba, referenceRgba: reference, metrics,
      rejected: !assessment.ok, failedGates: assessment.failures };
  });
}
export function bubbleInvariantNegatives() {
  const normalized = bubbleFieldAt([.75, .5], Array.from({ length: 24 }, () => [.5, .5]), .25, 14).logField;
  const unnormalized = normalized + Math.log(24);
  const schedule = BUBBLE_BASE_SCHEDULE;
  const expectedCenters = bubbleCentersAt(schedule, 48048, 96, 64).centers;
  const fps30 = bubbleCentersAt({ ...schedule, trailDurationTicks: 23 * 4004 }, 48048, 96, 64).centers;
  const fps60 = bubbleCentersAt({ ...schedule, trailDurationTicks: 23 * 2002 }, 48048, 96, 64).centers;
  const mutable = times => {
    let point = [.2, .5];
    return times.map(time => { point = point.map((value, axis) => value + .5 * (bubblePointerAt(schedule, time)[axis] - value)); return point; });
  };
  const ordered = mutable([0, 12012, 24024, 48048]).at(-1), cold = mutable([48048])[0];
  return [
    { id: 'unnormalized-field', kind: 'exact-invariant', rejected: Math.abs(normalized) < 1e-12 && Math.abs(unnormalized) > 1e-12,
      expected: normalized, mutant: unnormalized, reason: 'Coincident-ball boundary must remain at radius R for every ball count' },
    { id: 'frame-count-trail-delay', kind: 'exact-invariant', rejected: JSON.stringify(fps30) !== JSON.stringify(fps60),
      expected: { rate30: expectedCenters, rate60: expectedCenters }, mutant: { rate30: fps30, rate60: fps60 }, reason: 'Equal sampled ticks must not change centers when the output frame rate changes' },
    { id: 'mutable-frame-follow', kind: 'exact-invariant', rejected: JSON.stringify(ordered) !== JSON.stringify(cold),
      expected: { ordered: expectedCenters[0], cold: expectedCenters[0] }, mutant: { ordered, cold }, reason: 'Seeking to the same time cannot depend on previously requested frames' },
  ];
}

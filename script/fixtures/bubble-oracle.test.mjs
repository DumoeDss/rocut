import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import {
  bubbleCases, bubbleAdmissionCases, bubbleSupplementalAdmissionCases, bubbleMatrixWork,
  BUBBLE_BASE_SCHEDULE, BUBBLE_OPTICAL_OAT, BUBBLE_ALPHA_LEVELS,
  makeBubbleSource, flattenBubbleParams,
} from './bubble-cases.mjs';
import {
  renderBubbleOracle, bubbleFieldAt, bubbleRefractedOffset, sampleBubblePremultiplied,
  bubbleWorkBudget, validateBubbleOptics, BUBBLE_DEFAULTS,
} from './bubble-oracle.mjs';
import { validateBubbleSchedule, sampleBubbleTicks, bubbleHeadAt, bubblePointerAt, bubbleCentersAt } from './bubble-oracle-time.mjs';
import { BUBBLE_NATIVE_GATES, compareBubbleRgba, assessBubbleNative, reportBubbleReadbacks } from './bubble-metrics.mjs';
import { BUBBLE_NEGATIVE_CONTROLS, bubbleNegativesForCase, bubbleInvariantNegatives } from './bubble-negatives.mjs';

const evidence = { status: 'CPU-fixtures-only-not-production-acceptance', matrixWork: bubbleMatrixWork,
  tests: [], negativeControls: [], opticalOat: [], frameHashes: [], supplementalAdmission: bubbleSupplementalAdmissionCases,
  gpuOrBrowserOrWasmOrBuild: false };
function check(name, run) {
  test(name, async () => {
    try { const detail = await run(); evidence.tests.push({ name, ok: true, detail }); }
    catch (error) { evidence.tests.push({ name, ok: false, error: String(error), stack: error.stack }); throw error; }
  });
}
const byId = id => {
  const fixture = bubbleCases.find(item => item.id === id); assert(fixture, id); return fixture;
};
const input = fixture => makeBubbleSource(fixture.sourceSpec, fixture.width, fixture.height);
const cache = new Map();
function frame(fixture) {
  if (!cache.has(fixture.id)) cache.set(fixture.id, renderBubbleOracle(fixture, input(fixture)));
  return cache.get(fixture.id);
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

check('bounded grouped coverage and immutable fixture/source identity', () => {
  assert.equal(bubbleCases.length, 94); assert.equal(new Set(bubbleCases.map(item => item.id)).size, 94);
  assert.equal(BUBBLE_OPTICAL_OAT.length, 21);
  assert.deepEqual([...new Set(bubbleCases.filter(item => item.group === 'geometry').map(item => item.schedule.trail))], [1, 2, 8, 24]);
  assert.deepEqual([...new Set(bubbleCases.filter(item => item.group === 'geometry').map(item => item.params.blend))], [1, 14, 24]);
  assert.deepEqual([...new Set(bubbleCases.map(item => `${item.width}x${item.height}`))], ['96x64', '192x128', '96x256', '256x96']);
  assert.equal(bubbleMatrixWork.pixels, 632832); assert.equal(bubbleMatrixWork.fieldTerms, 13080576);
  assert.equal(bubbleMatrixWork.bilinearSamples, 6592512); assert.equal(bubbleMatrixWork.rawTexelLoads, 26370048);
  const ids = new Map();
  for (const fixture of bubbleCases) {
    assert(Object.isFrozen(fixture)); assert(Object.isFrozen(fixture.params)); assert(Object.isFrozen(fixture.schedule.knots));
    assert.equal(fixture.timelineTicks - fixture.timeOffsetTicks, fixture.ticks);
    const source = input(fixture), digest = hash(source);
    if (ids.has(fixture.sourceId)) assert.equal(ids.get(fixture.sourceId), digest); else ids.set(fixture.sourceId, digest);
    assert.equal(source.length, fixture.width * fixture.height * 4);
    assert(Object.values(flattenBubbleParams(fixture)).every(Number.isFinite));
  }
  return { frames: bubbleCases.length, uniqueSources: ids.size, maximumFrameBytes: bubbleMatrixWork.maximumFrameRgbaBytes };
});

check('all frames evaluate finitely without mutating canonical inputs; semantic equivalents are byte exact', () => {
  const equivalences = new Map();
  for (const fixture of bubbleCases) {
    const source = input(fixture), before = hash(source), result = frame(fixture);
    assert.equal(hash(source), before); assert.equal(result.rgba.length, source.length); assert.equal(result.work.historyStorageBytes, 0);
    assert(result.trajectorySegments <= 384); assert(result.centers.flat().every(Number.isFinite));
    const digest = hash(result.rgba); evidence.frameHashes.push({ id: fixture.id, sourceSha256: before, referenceSha256: digest, sampledTicks: result.sampledTicks });
    if (fixture.equivalenceKey) {
      if (equivalences.has(fixture.equivalenceKey)) assert.equal(digest, equivalences.get(fixture.equivalenceKey), fixture.id);
      else equivalences.set(fixture.equivalenceKey, digest);
    }
    if (fixture.group === 'identity' || fixture.id === 'path-offscreen' || fixture.id === 'input-transparent') assert.deepEqual(result.rgba, source, fixture.id);
  }
  return { frames: bubbleCases.length, equivalenceGroups: equivalences.size };
});

check('21 optical OAT controls change exactly one flattened scalar and affect pixels', () => {
  const base = byId('oat-baseline'), baseParams = flattenBubbleParams(base), expected = frame(base).rgba;
  for (const { control } of BUBBLE_OPTICAL_OAT) {
    const fixture = byId('oat-' + control), params = flattenBubbleParams(fixture);
    assert.deepEqual(Object.keys(params).filter(key => params[key] !== baseParams[key]), [control]);
    const metrics = compareBubbleRgba(frame(fixture).rgba, expected);
    assert(metrics.changedBytes > 0, control + ' must not be a no-op');
    const nativeLimitsComparison = assessBubbleNative(metrics);
    assert.equal(nativeLimitsComparison.ok, false, control + ' must carry a signal exceeding at least one unchanged RAW gate');
    evidence.opticalOat.push({ control, metrics, nativeLimitsComparison });
  }
  return { controls: evidence.opticalOat.length, criterion: 'one authored control, signal exceeding an unchanged RAW gate; not a GPU parity claim' };
});

check('17 pixel negative controls reject at least one unchanged native RAW gate; 3 exact invariants reject', () => {
  for (const fixture of bubbleCases) {
    for (const result of bubbleNegativesForCase(fixture, input(fixture), frame(fixture).rgba)) {
      const { mutantRgba, referenceRgba, ...record } = result;
      evidence.negativeControls.push({ ...record, mutantSha256: hash(mutantRgba), referenceSha256: hash(referenceRgba) });
      assert(result.rejected, result.id + ' is insensitive: ' + JSON.stringify(result.metrics));
      assert(result.failedGates.length > 0);
    }
  }
  const invariants = bubbleInvariantNegatives(); evidence.negativeControls.push(...invariants);
  assert(invariants.every(item => item.rejected));
  assert.equal(evidence.negativeControls.filter(item => item.kind === 'pixel').length, 17);
  assert.deepEqual(evidence.negativeControls.map(item => item.id).sort(), BUBBLE_NEGATIVE_CONTROLS.map(item => item.id).sort());
  return { pixel: 17, exactInvariant: 3 };
});

check('straight RGB mask is exactly both alpha >=16 and native/Canvas assessments remain separate', () => {
  assert.deepEqual(BUBBLE_NATIVE_GATES, { premultipliedRgbMean: .5, premultipliedRgbMaximum: 4, alphaMean: .35, alphaMaximum: 3,
    straightRgbMeanAtBothAlphaAtLeast16: 1.5, straightRgbMaximumAtBothAlphaAtLeast16: 8 });
  const expected = new Uint8Array([0, 0, 0, 15, 0, 0, 0, 16, 0, 0, 0, 16, 0, 0, 0, 0]);
  const actual = new Uint8Array([255, 255, 255, 255, 9, 9, 9, 16, 255, 255, 255, 15, 255, 255, 255, 0]);
  const metrics = compareBubbleRgba(actual, expected);
  assert.equal(metrics.straightComparedPixels, 1); assert.equal(metrics.straightRgbMeanAtBothAlphaAtLeast16, 9);
  assert.equal(metrics.straightRgbMaximumAtBothAlphaAtLeast16, 9);
  assert(Math.abs(metrics.premultipliedRgbMean - (255 + 9 * 16 / 255 + 15) / 4) < 1e-12);
  const report = reportBubbleReadbacks({ referenceRgba: expected, nativeRgba: expected, canvasRgba: actual });
  assert.equal(report.nativeTexture.ok, true); assert.equal(report.canvasPresentation.comparisonToNativeLimits.ok, false);
  assert.equal(compareBubbleRgba(new Uint8Array([255, 1, 0, 0]), new Uint8Array(4)).straightComparedPixels, 0);
  assert.equal(assessBubbleNative({ ...BUBBLE_NATIVE_GATES }).ok, true);
  assert.equal(assessBubbleNative({ ...BUBBLE_NATIVE_GATES, alphaMean: NaN }).ok, false);
  assert.throws(() => compareBubbleRgba(new Uint8Array(3), new Uint8Array(3)));
  return metrics;
});

check('alpha 0/1/8/16/64/128/255, poisoned hidden RGB and transparent OOB are preserved correctly', () => {
  for (const alpha of BUBBLE_ALPHA_LEVELS) {
    const source = input(byId(`alpha-${alpha}`));
    assert.equal(new Set(source.filter((_, index) => index % 4 === 3)).size, 1); assert.equal(source[3], alpha);
  }
  const poison = frame(byId('input-holes-poison')).rgba, clean = frame(byId('input-holes-clean')).rgba;
  let visible = 0;
  for (let index = 0; index < poison.length; index += 4) {
    assert.equal(poison[index + 3], clean[index + 3]);
    if (poison[index + 3] > 0) { assert.deepEqual(poison.subarray(index, index + 4), clean.subarray(index, index + 4)); visible++; }
  }
  const source = new Uint8Array([255, 0, 255, 0, 0, 255, 0, 255]);
  assert.deepEqual(sampleBubblePremultiplied(source, 2, 1, .5, 0), [0, .5, 0, .5]);
  assert.deepEqual(sampleBubblePremultiplied(source, 2, 1, -2, 0), [0, 0, 0, 0]);
  const exterior = input(byId('identity-neutral')); assert.deepEqual(frame(byId('identity-neutral')).rgba, exterior);
  assert(exterior.some((value, index) => index % 4 === 0 && value === 255 && exterior[index + 3] === 0));
  return { visiblePixelsCompared: visible };
});

check('pooled field radius, analytic gradient and unit normal match independent finite differences', () => {
  for (const count of [1, 2, 8, 24]) for (const blend of [1, 14, 24]) {
    const centers = Array.from({ length: count }, () => [.5, .5]);
    assert(Math.abs(bubbleFieldAt([.75, .5], centers, .25, blend).logField) < 1e-12);
  }
  let maximumRelativeGradientError = 0, maximumNormalError = 0;
  for (const centers of [[[.4, .5], [.7, .6]], [[.5, .5]]]) for (const point of [[.41, .52], [.62, .43], [.74, .61]]) for (const blend of [1, 14, 24]) {
    const field = bubbleFieldAt(point, centers, .25, blend), step = 1e-6;
    for (let axis = 0; axis < 2; axis++) {
      const plus = [...point], minus = [...point]; plus[axis] += step; minus[axis] -= step;
      const finite = (bubbleFieldAt(plus, centers, .25, blend).logField - bubbleFieldAt(minus, centers, .25, blend).logField) / (2 * step);
      const relative = Math.abs(finite - field.gradient[axis]) / Math.max(1, Math.abs(finite));
      maximumRelativeGradientError = Math.max(maximumRelativeGradientError, relative); assert(relative < 1e-5);
    }
    const normalError = Math.abs(Math.hypot(...field.normal) - 1); maximumNormalError = Math.max(maximumNormalError, normalError); assert(normalError <= 1e-12);
  }
  return { maximumRelativeGradientError, maximumNormalError };
});

function rk4(schedule, ticks) {
  const lambda = -60 * Math.log1p(-schedule.follow);
  let point = bubblePointerAt(schedule, 0), time = 0;
  const derivative = (t, p) => bubblePointerAt(schedule, t).map((target, axis) => lambda * (target - p[axis]));
  while (time < ticks) {
    const nextKnot = schedule.knots.find(knot => knot.ticks > time)?.ticks ?? ticks;
    const stepTicks = Math.min(6, ticks - time, nextKnot - time), dt = stepTicks / 120000;
    const k1 = derivative(time, point), k2 = derivative(time + stepTicks / 2, point.map((v, i) => v + dt * k1[i] / 2));
    const k3 = derivative(time + stepTicks / 2, point.map((v, i) => v + dt * k2[i] / 2));
    const k4 = derivative(time + stepTicks, point.map((v, i) => v + dt * k3[i]));
    point = point.map((v, i) => v + dt * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]) / 6); time += stepTicks;
  }
  return point;
}
check('closed-form follow matches RK4 and rational trail evaluation is order-independent', () => {
  let maximumAbsoluteCoordinateError = 0;
  for (const follow of [.0000001, .01, .5, .99]) for (const ticks of [1, 24024, 48048, 180180]) {
    const schedule = { ...BUBBLE_BASE_SCHEDULE, follow }, expected = rk4(schedule, ticks), actual = bubbleHeadAt(schedule, ticks).point;
    for (let axis = 0; axis < 2; axis++) {
      const error = Math.abs(actual[axis] - expected[axis]); maximumAbsoluteCoordinateError = Math.max(maximumAbsoluteCoordinateError, error); assert(error <= 1e-11);
    }
  }
  const schedule = byId('schedule-sixteen-knots').schedule;
  const time = 180180, expected = bubbleCentersAt(schedule, time, 96, 64);
  for (const query of [24024, 0, time, 48048, time]) bubbleCentersAt(schedule, query, 96, 64);
  assert.deepEqual(bubbleCentersAt(schedule, time, 96, 64), expected);
  assert(expected.segments <= 384);
  return { maximumAbsoluteCoordinateError, maximumSegmentsObserved: expected.segments };
});

check('original IOR=1 grazing f32 counterexample remains a physical regression witness', () => {
  const normal = [Math.fround(.99996924), Math.fround(-.007852955), Math.fround(.00017254721)];
  const nz = normal[2], originalK = Math.fround(1 - Math.fround(1 - Math.fround(nz * nz)));
  const originalFactor = Math.fround(nz - Math.fround(Math.sqrt(originalK)));
  assert.equal(nz, .0001725472102407366); assert.equal(originalK, 0); assert.equal(originalFactor, nz);
  const physicalOffset = bubbleRefractedOffset(normal, 1, 16);
  assert(physicalOffset.every(value => Math.abs(value) < 1e-10));
  const wrongOffset = 16 * originalFactor * normal[0] / (1 - originalFactor * nz);
  assert(Math.abs(wrongOffset - physicalOffset[0]) > .002);
  assert(Math.abs(-.014143308624625206 - (-.014142248120811692)) > 5e-7);
  return { normal, originalFactor, physicalOffset, wrongOffset,
    retainedIdealF64Failure: { actual: -.014143308624625206, ideal: -.014142248120811692, failedLimit: 5e-7 },
    interpretation: 'Post-quantization arithmetic tolerance is not ideal physical or native-pixel acceptance' };
});

function parseFlatAdmission(item) {
  const scalarKeys = Object.keys(BUBBLE_DEFAULTS).filter(key => !['tint', 'colorA', 'colorB'].includes(key));
  const scheduleKeys = ['startTicks', 'durationTicks', 'follow', 'trail', 'trailDurationTicks', 'pointCount'];
  const colors = ['tint', 'colorA', 'colorB'].flatMap(name => ['R', 'G', 'B'].map(suffix => name + suffix));
  const allowed = new Set([...scalarKeys, ...scheduleKeys, ...colors]);
  const count = item.params.pointCount; assert(Number.isInteger(count) && count >= 1 && count <= 16);
  const knots = Array.from({ length: count }, (_, index) => {
    const keys = ['Time', 'X', 'Y'].map(suffix => `point${index}${suffix}`); keys.forEach(key => { allowed.add(key); assert(Object.hasOwn(item.params, key)); });
    return { ticks: item.params[keys[0]], x: item.params[keys[1]], y: item.params[keys[2]] };
  });
  for (const key of Object.keys(item.params)) assert(allowed.has(key));
  const params = Object.fromEntries(scalarKeys.map(key => [key, item.params[key]]));
  for (const name of ['tint', 'colorA', 'colorB']) params[name] = ['R', 'G', 'B'].map(suffix => item.params[name + suffix]);
  const schedule = Object.fromEntries(scheduleKeys.filter(key => key !== 'pointCount').map(key => [key, item.params[key]])); schedule.knots = knots;
  validateBubbleSchedule(schedule); validateBubbleOptics(params); sampleBubbleTicks(item.ticks, item.frameRate);
  bubbleWorkBudget(item.width, item.height, schedule, params);
}
check('22 rejecting admission fixtures and work bounds are independently checked without allocating large frames', () => {
  assert.equal(bubbleAdmissionCases.length, 22);
  for (const item of bubbleAdmissionCases) assert.throws(() => parseFlatAdmission(item), undefined, item.id);
  const maximum = bubbleWorkBudget(3840, 2160, BUBBLE_BASE_SCHEDULE, { frost: 1, dispersion: 3 });
  assert(maximum.extraRgba8TargetBytes <= 32 * 1024 * 1024); assert.equal(maximum.fieldTerms, 199065600); assert.equal(maximum.bilinearSamples, 223948800);
  assert.throws(() => validateBubbleSchedule({ ...BUBBLE_BASE_SCHEDULE, knots: [{ ticks: 0, x: .5, y: .5, extra: 1 }] }));
  assert.throws(() => renderBubbleOracle(byId('geometry-trail24-blend14'), new Uint8Array(4)));
  assert.throws(() => renderBubbleOracle(byId('geometry-trail24-blend14'), Array(96 * 64 * 4).fill(0)));
  return { rejecting: 22, maximum4K: maximum, rejectionBoundNotMeasuredThroughput: true };
});

check('safe negative input supplemental admission preserves strict-oracle scope difference', () => {
  const item = bubbleSupplementalAdmissionCases[0]; assert.equal(bubbleSupplementalAdmissionCases.length, 1);
  assert.throws(() => sampleBubbleTicks(item.ticks, item.frameRate), /Unsafe quantized sample/);
  const sample = BigInt(item.sampledTicksExact);
  assert(sample < BigInt(Number.MIN_SAFE_INTEGER)); assert(sample < 0n);
  assert(Number.isSafeInteger(item.expectedFrameIndex)); assert.equal(BigInt(item.expectedFrameIndex) * 4004n, sample);
  assert.equal(item.scopeDifference.fullPixelOracleParity, false);
  return { frozenOracleThrows: true, mathematicalActivity: 'inactive', publicResolverExpected: 'success-empty-passes', productionExecuted: false };
});

check('browser modules are pure and strictly UTF-8 with no production dependencies', async () => {
  const files = ['bubble-cases.mjs', 'bubble-oracle.mjs', 'bubble-oracle-time.mjs', 'bubble-metrics.mjs', 'bubble-negatives.mjs'];
  const records = [];
  for (const filename of files) {
    const bytes = await readFile(new URL(filename, import.meta.url));
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    assert(!text.includes('\ufffd')); assert.notEqual(bytes.subarray(0, 3).toString('hex'), 'efbbbf');
    assert(!/\bBuffer\b|from\s*['"]node:|\bprocess\b|\brequire\s*\(/.test(text), filename);
    for (const match of text.matchAll(/from\s*['"]([^'"]+)['"]/g)) assert(/^\.\/bubble-(?:cases|oracle(?:-time)?|metrics|negatives)\.mjs$/.test(match[1]), filename + ': ' + match[1]);
    records.push({ filename, bytes: bytes.length, sha256: hash(bytes), strictUtf8: true });
  }
  evidence.sources = records; return records;
});

check('optional frozen CPU oracle parity uses supplied source bytes and retains safe-Number scope rejection', async () => {
  const root = process.env.BUBBLE_FROZEN_CONTRACT;
  if (!root) return { notRun: 'Set BUBBLE_FROZEN_CONTRACT to the retained independent contract directory' };
  const expectedPins = {
    'trajectory.mjs': '35029b46c0940507bdb0dfa20da7730dc91d79147cb59d8f91c77793a67a6b74',
    'optics.mjs': '52276612155ffa81fe46624065e9fb22a3cf9cebe1fd506da1cff73fd267459e',
    'contract.mjs': '0a29efa9650ba3a2fd3cf1644ed0369b8a41a9ce11735d79f1a72eaf2021770b',
  };
  for (const [name, pin] of Object.entries(expectedPins)) assert.equal(hash(await readFile(root + '/' + name)), pin);
  const frozen = await import(pathToFileURL(root + '/optics.mjs').href);
  const time = await import(pathToFileURL(root + '/trajectory.mjs').href);
  let casesCompared = 0, differentBytes = 0, maximumByteDifference = 0;
  for (const fixture of bubbleCases) {
    const source = input(fixture);
    const expected = fixture.enabled === false ? source : frozen.render(source, fixture.width, fixture.height, fixture.schedule, fixture.ticks, fixture.frameRate, fixture.params);
    const actual = frame(fixture).rgba;
    for (let index = 0; index < expected.length; index++) {
      const difference = Math.abs(expected[index] - actual[index]); if (difference) differentBytes++;
      maximumByteDifference = Math.max(maximumByteDifference, difference);
    }
    casesCompared++;
  }
  assert.equal(differentBytes, 0, 'Rational-delay adaptation changed retained source-frame pixels');
  assert.throws(() => time.sampleFrameTicks(Number.MIN_SAFE_INTEGER, { numerator: 30000, denominator: 1001 }));
  return { casesCompared, differentBytes, maximumByteDifference, pins: expectedPins, supplementalScopeParity: false };
});

after(async () => {
  if (process.env.BUBBLE_FIXTURE_REPORT_DIR) {
    evidence.ok = evidence.tests.every(item => item.ok);
    evidence.testSource = { path: fileURLToPath(import.meta.url), sha256: hash(await readFile(new URL(import.meta.url))) };
    await writeFile(process.env.BUBBLE_FIXTURE_REPORT_DIR + '/report.json', JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx', encoding: 'utf8' });
  }
});

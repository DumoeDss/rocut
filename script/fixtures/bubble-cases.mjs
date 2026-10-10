import { BUBBLE_DEFAULTS, validateBubbleOptics, bubbleWorkBudget } from './bubble-oracle.mjs';

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze); Object.freeze(value);
  }
  return value;
}
export const BUBBLE_ALPHA_LEVELS = freeze([0, 1, 8, 16, 64, 128, 255]);
export const BUBBLE_BASE_SCHEDULE = freeze({ startTicks: 0, durationTicks: 240000, follow: .5, trail: 24,
  trailDurationTicks: 46000, knots: [{ ticks: 0, x: .2, y: .5 }, { ticks: 60000, x: .8, y: .5 }] });
export const BUBBLE_NEUTRAL = freeze({ ...BUBBLE_DEFAULTS, refraction: 0, dispersion: 0, frost: 0, shine: 0, rim: 0, iridescence: 0, tintStrength: 0 });
const optical = { ...BUBBLE_NEUTRAL, radius: .15, refraction: .12, dispersion: 1 };
const pooled = { ...BUBBLE_BASE_SCHEDULE, follow: 1, knots: [{ ticks: 0, x: .5, y: .5 }] };
const edge = { ...pooled, trail: 8, knots: [{ ticks: 0, x: .02, y: .5 }] };
const edgeOptics = { ...optical, radius: .24, refraction: -.25, frost: .5, dispersion: 3 };
const ramp = { id: 'rgb-ramp', kind: 'ramp' };
const cases = [];
function add(id, group, overrides = {}) {
  const fixture = { id, group, width: 96, height: 64, sourceSpec: ramp,
    schedule: BUBBLE_BASE_SCHEDULE, params: optical, ticks: 48048,
    frameRate: { numerator: 30000, denominator: 1001 }, enabled: true,
    timeOffsetTicks: 0, trimStartTicks: 0, ...overrides };
  fixture.timelineTicks = fixture.ticks + fixture.timeOffsetTicks;
  fixture.sourceId = `${fixture.width}x${fixture.height}:${fixture.sourceSpec.id}`;
  cases.push(freeze(fixture));
}
for (const trail of [1, 2, 8, 24]) for (const blend of [1, 14, 24]) {
  add(`geometry-trail${trail}-blend${blend}`, 'geometry', {
    schedule: { ...BUBBLE_BASE_SCHEDULE, trail }, params: { ...optical, blend },
    ...(trail === 24 && blend === 14 ? { equivalenceKey: 'moving-48048' } : {}),
  });
}
add('path-turning', 'path', { ticks: 60060, params: { ...optical, radius: .1 }, schedule: { ...BUBBLE_BASE_SCHEDULE, follow: 1, knots: [
  { ticks: 0, x: .25, y: .65 }, { ticks: 24000, x: .5, y: .2 }, { ticks: 48000, x: .75, y: .65 }, { ticks: 72000, x: .5, y: .85 },
] } });
add('path-stopped', 'path', { ticks: 180180, schedule: { ...BUBBLE_BASE_SCHEDULE, follow: 1 } });
add('path-teleport-segment', 'path', { ticks: 36036, schedule: { ...BUBBLE_BASE_SCHEDULE, knots: [
  { ticks: 0, x: .2, y: .3 }, { ticks: 24000, x: .2, y: .3 }, { ticks: 24001, x: .8, y: .7 },
] } });
add('path-offscreen', 'path', { schedule: { ...pooled, knots: [{ ticks: 0, x: -1, y: 2 }] } });
add('path-follow-zero', 'path', { schedule: { ...BUBBLE_BASE_SCHEDULE, follow: 0 } });
add('path-follow-one', 'path', { schedule: { ...BUBBLE_BASE_SCHEDULE, follow: 1 } });
for (const [width, height] of [[192, 128], [96, 256], [256, 96]]) add(`aspect-${width}x${height}`, 'aspect', { width, height });
add('input-gray-dispersion', 'input', { sourceSpec: { id: 'gray-checker', kind: 'gray' }, params: { ...optical, dispersion: 3 } });
add('input-gray-frost', 'input', { sourceSpec: { id: 'gray-checker', kind: 'gray' }, schedule: pooled, params: { ...BUBBLE_NEUTRAL, radius: .25, frost: .5 } });
add('input-holes-poison', 'input', { sourceSpec: { id: 'holes-poison', kind: 'holes', hiddenRgb: 'poison' }, schedule: edge, params: edgeOptics });
add('input-holes-clean', 'input', { sourceSpec: { id: 'holes-clean', kind: 'holes', hiddenRgb: 'zero' }, schedule: edge, params: edgeOptics });
add('input-saturated-border', 'input', { sourceSpec: { id: 'saturated-border', kind: 'border' }, schedule: edge, params: edgeOptics });
add('input-transparent', 'input', { sourceSpec: { id: 'transparent-black', kind: 'transparent' }, schedule: pooled, params: { ...BUBBLE_DEFAULTS, radius: .25 } });
for (const alpha of BUBBLE_ALPHA_LEVELS) add(`alpha-${alpha}`, 'alpha', {
  sourceSpec: { id: `uniform-alpha-${alpha}`, kind: 'uniform-alpha', alpha, hiddenRgb: 'poison' }, schedule: edge, params: edgeOptics,
});
for (const [name, values] of [
  ['shine', { shine: 1 }], ['rim', { rim: 1 }], ['iridescence', { iridescence: 1 }], ['tint', { tintStrength: 1, tint: [.2, .8, 1] }],
]) add(`decoration-${name}`, 'decoration', { ticks: name === 'iridescence' ? 4004 : 48048, schedule: pooled, params: { ...BUBBLE_NEUTRAL, radius: .25, ...values } });

const oatBase = { ...BUBBLE_DEFAULTS, amount: .8, radius: .24, blend: 8, refraction: .18, ior: 1.4, dispersion: 1.5,
  frost: .2, shine: .7, rim: .8, iridescence: 1.7, intensity: 1.2, tintStrength: .35,
  tint: [.9, .7, .5], colorA: [.3, .8, .4], colorB: [.8, .4, .9] };
export const BUBBLE_OPTICAL_OAT = freeze([
  ['amount', 1], ['radius', .35], ['blend', 24], ['refraction', -.2], ['ior', 2.3], ['dispersion', 3],
  ['frost', .8], ['shine', 1.8], ['rim', 2], ['iridescence', .3], ['intensity', .3], ['tintStrength', 1],
  ['tintR', .1], ['tintG', .1], ['tintB', .1], ['colorAR', 1], ['colorAG', 0], ['colorAB', 1],
  ['colorBR', 0], ['colorBG', 1], ['colorBB', 0],
].map(([control, value]) => ({ control, value })));
const colorChannels = { tintR: ['tint', 0], tintG: ['tint', 1], tintB: ['tint', 2], colorAR: ['colorA', 0], colorAG: ['colorA', 1], colorAB: ['colorA', 2], colorBR: ['colorB', 0], colorBG: ['colorB', 1], colorBB: ['colorB', 2] };
add('oat-baseline', 'oat', { params: oatBase });
for (const { control, value } of BUBBLE_OPTICAL_OAT) {
  const params = { ...oatBase };
  if (colorChannels[control]) {
    const [name, index] = colorChannels[control]; params[name] = [...params[name]]; params[name][index] = value;
  } else params[control] = value;
  add(`oat-${control}`, 'oat', { params, control, baselineId: 'oat-baseline' });
}
const queries = [0, 12012, 24024, 48048, 72072, 96096, 72072, 48048, 24024, 0, 48048, 12012];
queries.forEach((ticks, index) => add(`seek-${index}-${ticks}`, 'seek', { ticks, equivalenceKey: `moving-${ticks}` }));
add('time-offset', 'phase', { timeOffsetTicks: 40040, equivalenceKey: 'moving-48048' });
add('time-source-trim', 'phase', { timeOffsetTicks: 12012, trimStartTicks: 16016, equivalenceKey: 'moving-48048' });
const alignedStart = Math.floor((Number.MAX_SAFE_INTEGER - BUBBLE_BASE_SCHEDULE.durationTicks) / 4004) * 4004;
add('time-large-safe', 'phase', { ticks: alignedStart + 48048, schedule: { ...BUBBLE_BASE_SCHEDULE, startTicks: alignedStart }, equivalenceKey: 'moving-48048' });
for (const [numerator, denominator] of [[24, 1], [25, 1], [30, 1], [60, 1], [120, 1], [24000, 1001], [30000, 1001], [60000, 1001]]) {
  add(`rate-${numerator}-${denominator}`, 'rate', { ticks: 60060, frameRate: { numerator, denominator },
    equivalenceKey: denominator === 1001 ? 'moving-60060' : numerator === 25 ? 'moving-57600' : 'moving-60000' });
}
const hidden = { id: 'holes-poison', kind: 'holes', hiddenRgb: 'poison' };
for (const [id, overrides] of [
  ['disabled', { enabled: false, expectedBypass: 'disabled-fixture-stack' }],
  ['amount-zero', { params: { ...optical, amount: 0 } }],
  ['neutral', { params: BUBBLE_NEUTRAL }],
  ['ior-one-neutral', { params: { ...BUBBLE_NEUTRAL, refraction: .12, ior: 1 } }],
  ['before-zero', { ticks: -1 }],
  ['before-start', { ticks: 8008, schedule: { ...BUBBLE_BASE_SCHEDULE, startTicks: 12000 } }],
  ['exact-end', { ticks: 240000, frameRate: { numerator: 30, denominator: 1 } }],
]) add(`identity-${id}`, 'identity', { sourceSpec: hidden, expectedBypass: 'empty-resolved-pass', ...overrides });
for (const ticks of [4004, 80080]) add(`speed-zero-${ticks}`, 'speed', { ticks, schedule: pooled,
  params: { ...BUBBLE_NEUTRAL, radius: .25, iridescence: 1, speed: 0 }, equivalenceKey: 'pooled-speed-zero' });
add('ior-one-grazing', 'grazing', { schedule: pooled, sourceSpec: { id: 'gray-checker', kind: 'gray' },
  params: { ...BUBBLE_NEUTRAL, radius: .24000001, refraction: .25, ior: 1, frost: .1 } });
add('schedule-sixteen-knots', 'bounds', { ticks: 180180, schedule: { ...BUBBLE_BASE_SCHEDULE, follow: .0000001,
  knots: Array.from({ length: 16 }, (_, index) => ({ ticks: index * 12000, x: .2 + .6 * (index % 2), y: .2 + .04 * index })) } });
export const bubbleCases = freeze(cases);

export function makeBubbleSource(sourceSpec, width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 8388608) throw new RangeError('Invalid source size');
  if (!['ramp', 'gray', 'holes', 'border', 'transparent', 'uniform-alpha'].includes(sourceSpec.kind)) throw new RangeError('Unknown source kind');
  if (sourceSpec.kind === 'uniform-alpha' && !BUBBLE_ALPHA_LEVELS.includes(sourceSpec.alpha)) throw new RangeError('Unknown alpha level');
  const result = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let rgb = [Math.round(255 * x / Math.max(1, width - 1)), Math.round(255 * y / Math.max(1, height - 1)), (13 * x + 7 * y) % 256], alpha = 255;
    if (sourceSpec.kind === 'gray') rgb = Array(3).fill((x + y) % 2 ? 240 : 15);
    if (sourceSpec.kind === 'border' && x < 3) rgb = [255, 32, 0];
    if (sourceSpec.kind === 'holes') alpha = (x + 2 * y) % 23 < 8 ? 0 : [1, 8, 16, 64, 128, 255][Math.floor(x / 8) % 6];
    if (sourceSpec.kind === 'uniform-alpha') alpha = sourceSpec.alpha;
    if (sourceSpec.kind === 'transparent') { rgb = [0, 0, 0]; alpha = 0; }
    if (alpha === 0) rgb = sourceSpec.hiddenRgb === 'poison' ? [255, 0, 255] : [0, 0, 0];
    result.set([...rgb, alpha], (y * width + x) * 4);
  }
  return result;
}
export function flattenBubbleParams(fixture) {
  const opticalValues = validateBubbleOptics(fixture.params), { tint, colorA, colorB, ...values } = opticalValues;
  for (const [index, suffix] of ['R', 'G', 'B'].entries()) {
    values['tint' + suffix] = tint[index]; values['colorA' + suffix] = colorA[index]; values['colorB' + suffix] = colorB[index];
  }
  const { knots, ...schedule } = fixture.schedule;
  Object.assign(values, schedule, { pointCount: knots.length });
  knots.forEach((knot, index) => Object.assign(values, { [`point${index}Time`]: knot.ticks, [`point${index}X`]: knot.x, [`point${index}Y`]: knot.y }));
  return values;
}
export const bubbleMatrixWork = freeze(bubbleCases.reduce((sum, fixture) => {
  const work = bubbleWorkBudget(fixture.width, fixture.height, fixture.schedule, fixture.params);
  for (const key of ['pixels', 'fieldTerms', 'bilinearSamples', 'rawTexelLoads']) sum[key] += work[key];
  sum.maximumFrameRgbaBytes = Math.max(sum.maximumFrameRgbaBytes, work.extraRgba8TargetBytes);
  sum.frames++; return sum;
}, { frames: 0, pixels: 0, fieldTerms: 0, bilinearSamples: 0, rawTexelLoads: 0, maximumFrameRgbaBytes: 0 }));

const admissionBase = bubbleCases.find(fixture => fixture.id === 'geometry-trail24-blend14');
const flatBase = flattenBubbleParams(admissionBase);
export const bubbleAdmissionCases = freeze([
  ['unknown-optic', { unknownOpticalField: 1 }], ['radius-nan', { radius: NaN }], ['ior-below-one', { ior: .99 }],
  ['color-over-one', { colorAG: 1.01 }], ['fractional-trail', { trail: 2.5 }], ['too-many-balls', { trail: 25 }],
  ['negative-start', { startTicks: -1 }], ['duration-too-short', { durationTicks: 999 }],
  ['unsafe-end', { startTicks: Number.MAX_SAFE_INTEGER - 999 }], ['delay-too-long', { trailDurationTicks: 120001 }],
  ['no-knots', { pointCount: 0 }], ['first-knot-nonzero', { point0Time: 1 }], ['duplicate-knot', { point1Time: 0 }],
  ['knot-after-end', { point1Time: 240001 }], ['offscreen-out-of-range', { point1X: 2.01 }], ['inactive-knot-slot', { point2Time: 70000 }],
].map(([id, overrides]) => ({ id, params: { ...flatBase, ...overrides }, ticks: admissionBase.ticks, frameRate: admissionBase.frameRate,
  width: 96, height: 64, stage: 'resolve', expectedError: 'Invalid authored Bubble parameters' })).concat([
  { id: 'missing-knot-coordinate', params: Object.fromEntries(Object.entries(flatBase).filter(([key]) => key !== 'point1Y')), ticks: 48048, frameRate: admissionBase.frameRate, width: 96, height: 64, stage: 'resolve', expectedError: 'Incomplete active knot' },
  ...[
    ['nonintegral-rate', { numerator: 29, denominator: 1 }, 48048], ['zero-rate', { numerator: 0, denominator: 1 }, 48048],
    ['unsafe-ticks', admissionBase.frameRate, Number.MAX_SAFE_INTEGER + 1],
  ].map(([id, frameRate, ticks]) => ({ id, params: flatBase, ticks, frameRate, width: 96, height: 64, stage: 'resolve', expectedError: 'Invalid sample time or frame rate' })),
  { id: 'dimension-over-limit', params: flatBase, ticks: 48048, frameRate: admissionBase.frameRate, width: 8193, height: 1, stage: 'work', expectedError: 'Invalid output dimensions' },
  { id: 'pixels-over-limit', params: flatBase, ticks: 48048, frameRate: admissionBase.frameRate, width: 4096, height: 4096, stage: 'work', cpuOnly: true, expectedError: 'Bubble work budget exceeded' },
]));
// Supplemental resolver scope, deliberately outside the frozen safe-Number pixel oracle.
// The authored input is safe; only the inactive i128 intermediate floor lies below MIN_SAFE.
const supplementalTicks = BigInt(Number.MIN_SAFE_INTEGER), supplementalQuantum = 4004n;
const supplementalFrame = -((-supplementalTicks + supplementalQuantum - 1n) / supplementalQuantum);
export const bubbleSupplementalAdmissionCases = freeze([{
  id: 'safe-negative-input-inactive-wide-sample', params: flatBase, ticks: Number.MIN_SAFE_INTEGER,
  frameRate: admissionBase.frameRate, width: 96, height: 64,
  expectedSuccess: true, expectedEmptyPasses: true, expectedFrameIndex: Number(supplementalFrame),
  sampledTicksExact: String(supplementalFrame * supplementalQuantum),
  scopeDifference: {
    frozenSampleFrameTicks: 'Throws because its returned sample must be a safe Number',
    publicResolver: 'Safe input, safe frame index, wide-integer inactive sample; return no passes',
    withdrawnInitialClassification: 'Initially listed as unsafe-negative-quantization in rejecting admission table',
    fullPixelOracleParity: false,
  },
}]);

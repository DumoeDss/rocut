import { requireBubble, validateBubbleSchedule, sampleBubbleTicks, bubbleCentersAt } from './bubble-oracle-time.mjs';

export const BUBBLE_ORACLE_CONTRACT = Object.freeze({
  contractSha256: '5b9d13fa8e45209ec1b87434d281880f8e67b49249a5fc5d4caea96a6b752023',
  trajectorySha256: '35029b46c0940507bdb0dfa20da7730dc91d79147cb59d8f91c77793a67a6b74',
  opticsSha256: '52276612155ffa81fe46624065e9fb22a3cf9cebe1fd506da1cff73fd267459e',
  interpretation: 'Independent f64 CPU oracle; input is externally canonicalized straight RGBA8. Not a production resolver or shader.',
});
const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const normalize = vector => {
  const scale = Math.max(...vector.map(Math.abs));
  if (!scale) return [0, 0, 1];
  const scaled = vector.map(value => value / scale), length = Math.hypot(...scaled);
  return scaled.map(value => value / length);
};
export const BUBBLE_DEFAULTS = Object.freeze({
  amount: 1, radius: 30 / 1080, blend: 14, refraction: 80 / 1080, ior: 1.33,
  dispersion: 1, frost: 0, shine: .25, rim: .5, iridescence: 1, intensity: .9,
  speed: 2, tintStrength: 0, tint: Object.freeze([1, 1, 1]),
  colorA: Object.freeze([.2902, .4549, .7216]), colorB: Object.freeze([.4118, .4118, .4157]),
});
export const BUBBLE_RANGES = Object.freeze({
  amount: [0, 1], radius: [.005, .5], blend: [1, 24], refraction: [-.25, .25],
  ior: [1, 2.5], dispersion: [0, 3], frost: [0, 1], shine: [0, 2], rim: [0, 2],
  iridescence: [0, 2], intensity: [0, 5], speed: [0, 6], tintStrength: [0, 1],
});
export function validateBubbleOptics(parameters = {}) {
  for (const key of Object.keys(parameters)) requireBubble(Object.hasOwn(BUBBLE_DEFAULTS, key), 'Unknown optical parameter: ' + key);
  const values = { ...BUBBLE_DEFAULTS, ...parameters };
  for (const [key, [minimum, maximum]] of Object.entries(BUBBLE_RANGES)) {
    requireBubble(Number.isFinite(values[key]) && values[key] >= minimum && values[key] <= maximum, 'Invalid ' + key);
  }
  for (const key of ['tint', 'colorA', 'colorB']) {
    requireBubble(Array.isArray(values[key]) && values[key].length === 3, 'Invalid ' + key);
    requireBubble(values[key].every(value => Number.isFinite(value) && value >= 0 && value <= 1), 'Invalid ' + key + ' channel');
  }
  return values;
}
export function bubbleWorkBudget(width, height, schedule, parameters = {}) {
  const values = validateBubbleOptics(parameters);
  validateBubbleSchedule(schedule);
  requireBubble(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 && width <= 8192 && height <= 8192, 'Invalid output dimensions');
  const pixels = width * height, fieldTerms = pixels * schedule.trail;
  const bilinearSamples = pixels * (values.dispersion === 0 ? 1 : 3) * (values.frost === 0 ? 1 : 9);
  requireBubble(pixels <= 8388608 && fieldTerms <= 250000000 && bilinearSamples <= 240000000, 'Bubble work budget exceeded');
  return { pixels, fieldTerms, bilinearSamples, rawTexelLoads: bilinearSamples * 4,
    maximumTrajectorySegments: 384, historyStorageBytes: 0, maximumUniformBytes: 2048, extraRgba8TargetBytes: pixels * 4 };
}
export function bubbleFieldAt(point, centers, radius, blend) {
  const exponent = 1 + 7 * (blend - 1) / 23;
  const epsilonSquared = (.02 * radius) ** 2, scaleSquared = radius * radius + epsilonSquared;
  const terms = centers.map(center => {
    const dx = point[0] - center[0], dy = point[1] - center[1];
    const denominator = dx * dx + dy * dy + epsilonSquared;
    return { log: exponent * (Math.log(scaleSquared) - Math.log(denominator)),
      gradient: [-2 * exponent * dx / denominator, -2 * exponent * dy / denominator] };
  });
  const maximum = Math.max(...terms.map(term => term.log));
  const weights = terms.map(term => Math.exp(term.log - maximum));
  const total = weights.reduce((a, b) => a + b, 0);
  const logField = maximum + Math.log(total / centers.length);
  const gradient = [0, 1].map(axis => terms.reduce((sum, term, index) => sum + weights[index] / total * term.gradient[axis], 0));
  const inverse = Math.exp(-Math.max(0, logField) / exponent);
  const height = Math.sqrt(Math.max(0, scaleSquared * (1 - inverse)));
  const factor = scaleSquared * inverse / (2 * exponent);
  const normal = normalize([-factor * gradient[0], -factor * gradient[1], height]);
  return { logField, gradient, height, normal, signedDistance: logField / Math.max(1e-6, Math.hypot(...gradient)) };
}
export function bubbleRefractedOffset(normal, ior, thickness) {
  // Physical f64 equation from the frozen oracle, not the production f32 cancellation workaround.
  const eta = 1 / ior, nz = normal[2];
  const factor = eta * nz - Math.sqrt(Math.max(0, 1 - eta * eta * (1 - nz * nz)));
  const z = -eta + factor * nz;
  return [thickness * factor * normal[0] / -z, thickness * factor * normal[1] / -z];
}
export function sampleBubblePremultiplied(source, width, height, x, y, mutant) {
  if (mutant === 'edge-clamp') { x = clamp(x, 0, width - 1); y = clamp(y, 0, height - 1); }
  const left = Math.floor(x), top = Math.floor(y), fx = x - left, fy = y - top, result = [0, 0, 0, 0];
  for (let iy = 0; iy < 2; iy++) for (let ix = 0; ix < 2; ix++) {
    const px = left + ix, py = top + iy;
    if (px < 0 || py < 0 || px >= width || py >= height) continue;
    const offset = (py * width + px) * 4, weight = (ix ? fx : 1 - fx) * (iy ? fy : 1 - fy), alpha = source[offset + 3] / 255;
    for (let channel = 0; channel < 3; channel++) result[channel] += source[offset + channel] / 255 * (mutant === 'straight-alpha' ? 1 : alpha) * weight;
    result[3] += alpha * weight;
  }
  if (mutant === 'straight-alpha') for (let channel = 0; channel < 3; channel++) result[channel] *= result[3];
  return result;
}
function blurredSample(source, width, height, x, y, spread, mutant) {
  if (spread === 0) return sampleBubblePremultiplied(source, width, height, x, y, mutant);
  const result = [0, 0, 0, 0], kernel = [1, 2, 1];
  for (let iy = 0; iy < 3; iy++) for (let ix = 0; ix < 3; ix++) {
    const sample = sampleBubblePremultiplied(source, width, height, x + (ix - 1) * spread, y + (iy - 1) * spread, mutant);
    for (let channel = 0; channel < 4; channel++) result[channel] += sample[channel] * kernel[ix] * kernel[iy] / 16;
  }
  return result;
}
export function renderBubbleOracle(fixture, source, mutant) {
  const { width, height, schedule, ticks, frameRate } = fixture;
  const work = bubbleWorkBudget(width, height, schedule, fixture.params);
  requireBubble(source instanceof Uint8Array || source instanceof Uint8ClampedArray, 'Canonical input must be byte RGBA');
  requireBubble(source.length === width * height * 4, 'Canonical RGBA length mismatch');
  const p = validateBubbleOptics(fixture.params), rgba = new Uint8Array(source);
  const sampledTicks = sampleBubbleTicks(ticks, frameRate), elapsedExact = BigInt(sampledTicks) - BigInt(schedule.startTicks);
  const elapsedTicks = Number(elapsedExact);
  const result = { rgba, sampledTicks, elapsedTicks, centers: [], work, trajectorySegments: 0, bypass: null };
  if (fixture.enabled === false) return { ...result, bypass: 'disabled' };
  if (elapsedExact < 0n || elapsedExact >= BigInt(schedule.durationTicks)) return { ...result, bypass: 'inactive' };
  if (p.amount === 0) return { ...result, bypass: 'amount-zero' };
  if ((p.refraction === 0 || (p.ior === 1 && p.dispersion === 0)) && p.frost === 0 && p.shine === 0 && p.rim === 0 && p.iridescence === 0 && p.tintStrength === 0) return { ...result, bypass: 'neutral' };
  const resolved = bubbleCentersAt(schedule, elapsedTicks, width, height), centers = resolved.centers, short = Math.min(width, height);
  result.centers = centers; result.trajectorySegments = resolved.segments;
  const headOnly = mutant === 'single-head' ? centers.slice(0, 1) : centers;
  const light = normalize([-.45, -.55, .7]), half = normalize([light[0], light[1], light[2] + 1]);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const point = [(x + .5) / short, (y + .5) / short];
    if (headOnly.every(center => Math.hypot(point[0] - center[0], point[1] - center[1]) > p.radius + 2 / short)) continue;
    const field = bubbleFieldAt(point, headOnly, p.radius, p.blend);
    const edge = clamp(field.signedDistance * short + .5), coverage = edge * edge * (3 - 2 * edge), amount = p.amount * coverage;
    if (!amount) continue;
    const normal = mutant === 'radial-head-normal' ? bubbleFieldAt(point, centers.slice(0, 1), p.radius, p.blend).normal : field.normal;
    const channels = [0, 1, 2].map(channel => {
      if (mutant === 'source-independent-overlay') return [.25, .5, .75, 1];
      const index = Math.max(1, p.ior + (channel - 1) * .015 * p.dispersion);
      const offset = bubbleRefractedOffset(normal, index, p.refraction * short);
      return blurredSample(source, width, height, x + offset[0], y + offset[1], .03 * p.frost * short, mutant);
    });
    const alpha = Math.max(...channels.map(sample => sample[3])), rgb = channels.map((sample, channel) => sample[channel]);
    const rim = 1 - Math.min(.95, .45 * p.rim) * (1 - normal[2]) ** 3;
    const specular = Math.max(0, normal.reduce((sum, value, axis) => sum + value * half[axis], 0)) ** 48 * p.shine;
    const phase = 2 * Math.PI * ((p.speed * elapsedTicks / 120000) % 1 + .7 * normal[0] + .4 * normal[1] + .25 * field.height / p.radius);
    const cycle = .5 + .5 * Math.sin(phase), sheen = clamp(p.intensity * cycle) ** 3 * p.iridescence * .2;
    const index = (y * width + x) * 4, baseAlpha = source[index + 3] / 255;
    const outAlpha = (1 - amount) * baseAlpha + amount * alpha;
    rgba[index + 3] = Math.round(outAlpha * 255);
    for (let channel = 0; channel < 3; channel++) {
      const tinted = rgb[channel] * (1 - p.tintStrength + p.tint[channel] * p.tintStrength) * rim;
      const color = p.colorA[channel] * (1 - cycle) + p.colorB[channel] * cycle;
      const optical = clamp(tinted + alpha * (specular + sheen * color), 0, alpha);
      const final = (1 - amount) * source[index + channel] / 255 * baseAlpha + amount * optical;
      rgba[index + channel] = rgba[index + 3] ? Math.round(clamp(final / outAlpha) * 255) : 0;
    }
  }
  return result;
}

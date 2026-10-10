// Independent CPU test fixture. Timebase and equations are frozen in the Bubble v1 contract.
export const BUBBLE_TIMEBASE = 120000;
export function requireBubble(condition, message) {
  if (!condition) throw new RangeError(message);
}
export function validateBubbleSchedule(schedule) {
  requireBubble(schedule && typeof schedule === 'object', 'Missing schedule');
  requireBubble(Number.isSafeInteger(schedule.startTicks) && schedule.startTicks >= 0, 'Invalid startTicks');
  requireBubble(Number.isSafeInteger(schedule.durationTicks) && schedule.durationTicks >= 1000 && schedule.durationTicks <= 3600000, 'Invalid durationTicks');
  requireBubble(Number.isSafeInteger(schedule.startTicks + schedule.durationTicks), 'Unsafe activity end');
  requireBubble(Array.isArray(schedule.knots) && schedule.knots.length >= 1 && schedule.knots.length <= 16, 'Invalid knot count');
  requireBubble(schedule.knots[0].ticks === 0, 'First knot must start at zero');
  let previous = -1;
  for (const knot of schedule.knots) {
    requireBubble(Object.keys(knot).sort().join(',') === 'ticks,x,y', 'Unknown knot key');
    requireBubble(Number.isSafeInteger(knot.ticks) && knot.ticks > previous && knot.ticks <= schedule.durationTicks, 'Invalid knot time');
    requireBubble(Number.isFinite(knot.x) && knot.x >= -1 && knot.x <= 2, 'Invalid knot x');
    requireBubble(Number.isFinite(knot.y) && knot.y >= -1 && knot.y <= 2, 'Invalid knot y');
    previous = knot.ticks;
  }
  requireBubble(Number.isFinite(schedule.follow) && schedule.follow >= 0 && schedule.follow <= 1, 'Invalid follow');
  requireBubble(Number.isInteger(schedule.trail) && schedule.trail >= 1 && schedule.trail <= 24, 'Invalid trail');
  requireBubble(Number.isSafeInteger(schedule.trailDurationTicks) && schedule.trailDurationTicks >= 0 && schedule.trailDurationTicks <= 120000, 'Invalid trail duration');
  return schedule;
}
export function sampleBubbleTicks(ticks, frameRate) {
  requireBubble(Number.isSafeInteger(ticks), 'Unsafe sample ticks');
  requireBubble(Number.isSafeInteger(frameRate.numerator) && frameRate.numerator >= 1 && frameRate.numerator <= 120000, 'Invalid rate numerator');
  requireBubble(Number.isSafeInteger(frameRate.denominator) && frameRate.denominator >= 1 && frameRate.denominator <= 1001, 'Invalid rate denominator');
  const dividend = BigInt(BUBBLE_TIMEBASE) * BigInt(frameRate.denominator);
  requireBubble(dividend % BigInt(frameRate.numerator) === 0n, 'Nonintegral ticks per frame');
  const quantum = dividend / BigInt(frameRate.numerator), time = BigInt(ticks);
  const frame = time >= 0n ? time / quantum : -((-time + quantum - 1n) / quantum);
  const sample = frame * quantum;
  requireBubble(sample >= BigInt(Number.MIN_SAFE_INTEGER) && sample <= BigInt(Number.MAX_SAFE_INTEGER), 'Unsafe quantized sample');
  return Number(sample);
}
export function bubblePointerAt(schedule, ticks) {
  const knots = schedule.knots;
  if (ticks <= 0) return [knots[0].x, knots[0].y];
  for (let index = 1; index < knots.length; index++) {
    const a = knots[index - 1], b = knots[index];
    if (ticks <= b.ticks) {
      const fraction = (ticks - a.ticks) / (b.ticks - a.ticks);
      return [a.x + (b.x - a.x) * fraction, a.y + (b.y - a.y) * fraction];
    }
  }
  return [knots.at(-1).x, knots.at(-1).y];
}
export function bubbleHeadAt(schedule, ticks) {
  const t = Math.max(0, ticks), knots = schedule.knots;
  if (schedule.follow === 1) return { point: bubblePointerAt(schedule, t), segments: 0 };
  let point = [knots[0].x, knots[0].y], segments = 0;
  if (schedule.follow === 0 || t === 0) return { point, segments };
  const lambda = -60 * Math.log1p(-schedule.follow);
  for (let index = 0; index < knots.length; index++) {
    const a = knots[index], b = knots[index + 1];
    if (t <= a.ticks) break;
    const end = Math.min(t, b?.ticks ?? t), seconds = (end - a.ticks) / BUBBLE_TIMEBASE;
    const exponent = lambda * seconds, gain = -Math.expm1(-exponent);
    const integral = seconds * (exponent < 1e-4
      ? exponent / 2 - exponent ** 2 / 6 + exponent ** 3 / 24 - exponent ** 4 / 120
      : 1 + Math.expm1(-exponent) / exponent);
    const velocity = b ? [(b.x - a.x) * BUBBLE_TIMEBASE / (b.ticks - a.ticks), (b.y - a.y) * BUBBLE_TIMEBASE / (b.ticks - a.ticks)] : [0, 0];
    point = point.map((value, axis) => value + ([a.x, a.y][axis] - value) * gain + velocity[axis] * integral);
    segments++;
    if (end === t) break;
  }
  return { point, segments };
}
export function bubbleCentersAt(schedule, elapsedTicks, width, height) {
  requireBubble(Number.isSafeInteger(elapsedTicks) && elapsedTicks >= 0, 'Invalid elapsed ticks');
  const shortSide = Math.min(width, height), centers = [];
  let segments = 0;
  const divisor = BigInt(Math.max(1, schedule.trail - 1));
  for (let index = 0; index < schedule.trail; index++) {
    // Form the fractional delay before converting to f64; never quantize each ball to a frame.
    const numerator = divisor * BigInt(elapsedTicks) - BigInt(index) * BigInt(schedule.trailDurationTicks);
    const ticks = numerator <= 0n ? 0 : Number(numerator) / Number(divisor);
    const result = bubbleHeadAt(schedule, ticks);
    segments += result.segments;
    centers.push([result.point[0] * width / shortSide, result.point[1] * height / shortSide]);
  }
  requireBubble(segments <= 384, 'Trajectory segment budget exceeded');
  return { centers, segments };
}

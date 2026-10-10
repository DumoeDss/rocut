use super::interval::Interval;

const HALF_LEAF: f64 = 1.0 / 2_097_152.0;

fn up_add(a: f64, b: f64) -> Option<f64> {
    let result = (a + b).next_up();
    result.is_finite().then_some(result)
}

fn up_mul(a: f64, b: f64) -> Option<f64> {
    let result = (a * b).next_up();
    result.is_finite().then_some(result)
}

fn roundoff(p: [f64; 4]) -> Option<f64> {
    if p.iter().any(|value| !value.is_finite()) {
        return None;
    }
    let magnitude = p.into_iter().map(f64::abs).fold(0.0, f64::max);
    let error = up_add(up_mul(4.0 * f64::EPSILON, magnitude)?, f64::from_bits(16))?;
    // Bounds every partial-sum argument before assuming no overflow.
    up_add(magnitude, error)?;
    Some(error)
}

fn mix(left: Interval, right: Interval, t: f64) -> Option<Interval> {
    // t is a 21-bit dyadic; 1-t is exact, not an approximate real coefficient.
    left.mul(Interval::point(1.0 - t))?
        .add(right.mul(Interval::point(t))?)
}

fn blossom(p: [f64; 4], t: [f64; 3]) -> Option<Interval> {
    let first = [
        mix(Interval::point(p[0]), Interval::point(p[1]), t[0])?,
        mix(Interval::point(p[1]), Interval::point(p[2]), t[0])?,
        mix(Interval::point(p[2]), Interval::point(p[3]), t[0])?,
    ];
    let second = [
        mix(first[0], first[1], t[1])?,
        mix(first[1], first[2], t[1])?,
    ];
    mix(second[0], second[1], t[2])
}

pub(super) fn tight_range(lower: f64, upper: f64, p: [f64; 4]) -> Option<Interval> {
    let a = lower + HALF_LEAF;
    let b = upper - HALF_LEAF;
    if !(0.0..=1.0).contains(&a)
        || !(a..=1.0).contains(&b)
        || (a * 2_097_152.0).fract() != 0.0
        || (b * 2_097_152.0).fract() != 0.0
    {
        return None;
    }
    let error = roundoff(p)?;
    let q = [
        blossom(p, [a, a, a])?,
        blossom(p, [a, a, b])?,
        blossom(p, [a, b, b])?,
        blossom(p, [b, b, b])?,
    ];
    let real = Interval {
        lo: q.iter().map(|q| q.lo).fold(f64::INFINITY, f64::min),
        hi: q.iter().map(|q| q.hi).fold(f64::NEG_INFINITY, f64::max),
    };
    if !real.finite() {
        return None;
    }
    real.add(Interval {
        lo: -error,
        hi: error,
    })
}

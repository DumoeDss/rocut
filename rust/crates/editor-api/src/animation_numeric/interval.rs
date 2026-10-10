#[derive(Clone, Copy, Debug)]
pub(crate) struct Interval {
    pub lo: f64,
    pub hi: f64,
}

impl Interval {
    pub fn point(value: f64) -> Self {
        Self {
            lo: value,
            hi: value,
        }
    }

    fn outward(lo: f64, hi: f64) -> Option<Self> {
        if !lo.is_finite() || !hi.is_finite() {
            return None;
        }
        Some(Self {
            lo: lo.next_down(),
            hi: hi.next_up(),
        })
    }

    pub fn add(self, other: Self) -> Option<Self> {
        Self::outward(self.lo + other.lo, self.hi + other.hi)
    }

    pub fn sub(self, other: Self) -> Option<Self> {
        Self::outward(self.lo - other.hi, self.hi - other.lo)
    }

    pub fn mul(self, other: Self) -> Option<Self> {
        let products = [
            self.lo * other.lo,
            self.lo * other.hi,
            self.hi * other.lo,
            self.hi * other.hi,
        ];
        if products.iter().any(|value| !value.is_finite()) {
            return None;
        }
        let lo = products.into_iter().fold(f64::INFINITY, f64::min);
        let hi = products.into_iter().fold(f64::NEG_INFINITY, f64::max);
        Self::outward(lo, hi)
    }

    pub fn finite(self) -> bool {
        self.lo.is_finite() && self.hi.is_finite()
    }
}

/// Every operation follows the sampler's Bernstein expression, with outward
/// rounding after each binary operation. This is an enclosure, not an estimate.
pub(crate) fn bernstein_range(u: Interval, p: [f64; 4]) -> Option<Interval> {
    let mt = Interval::point(1.0).sub(u)?;
    let first = mt.mul(mt)?.mul(mt)?.mul(Interval::point(p[0]))?;
    let second = Interval::point(3.0)
        .mul(mt)?
        .mul(mt)?
        .mul(u)?
        .mul(Interval::point(p[1]))?;
    let third = Interval::point(3.0)
        .mul(mt)?
        .mul(u)?
        .mul(u)?
        .mul(Interval::point(p[2]))?;
    let fourth = u.mul(u)?.mul(u)?.mul(Interval::point(p[3]))?;
    first.add(second)?.add(third)?.add(fourth)
}

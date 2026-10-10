use super::model::*;

pub(crate) const SOLVE_ITERATIONS: u8 = 20;

pub struct ValidatedChannel<'a> {
    pub(crate) keys: &'a [ScalarKey],
    pub(crate) before: Extrapolation,
    pub(crate) after: Extrapolation,
    pub(crate) fallback: f64,
}

impl<'a> ValidatedChannel<'a> {
    pub fn new(
        keys: &'a [ScalarKey],
        before: Extrapolation,
        after: Extrapolation,
        fallback: f64,
    ) -> Result<Self, NumericIssue> {
        if !fallback.is_finite() {
            return Err(NumericIssue::new(IssueKind::NonFiniteInput, None));
        }
        for (index, key) in keys.iter().enumerate() {
            let fail = |kind| NumericIssue::new(kind, Some(index));
            if key.time > MAX_SAFE_TICKS {
                return Err(fail(IssueKind::InvalidKeyTime));
            }
            if index > 0 && keys[index - 1].time >= key.time {
                return Err(fail(IssueKind::UnorderedKeys));
            }
            if !key.value.is_finite() {
                return Err(fail(IssueKind::NonFiniteInput));
            }
            for (handle, is_left) in [(key.left, true), (key.right, false)] {
                if let Some(handle) = handle {
                    if !handle.dv.is_finite()
                        || handle.dt.unsigned_abs() > MAX_SAFE_TICKS
                        || (is_left && handle.dt > 0)
                        || (!is_left && handle.dt < 0)
                    {
                        return Err(fail(IssueKind::InvalidHandle));
                    }
                }
            }
        }
        Ok(Self {
            keys,
            before,
            after,
            fallback,
        })
    }

    /// Follows the existing scalar operation order; no value clamp or epsilon.
    pub fn sample(&self, time: f64) -> Result<f64, NumericIssue> {
        if !time.is_finite() {
            return Err(NumericIssue::new(IssueKind::NonFiniteTime, None));
        }
        let Some(first) = self.keys.first() else {
            return Ok(self.fallback);
        };
        if self.keys.len() == 1 {
            return Ok(first.value);
        }
        let last_index = self.keys.len() - 1;
        let last = &self.keys[last_index];
        if time < first.time as f64 {
            return finite(self.edge(time, 0, 1, self.before), 0);
        }
        if time > last.time as f64 {
            return finite(
                self.edge(time, last_index, last_index - 1, self.after),
                last_index,
            );
        }
        let right = self.keys.partition_point(|key| (key.time as f64) < time);
        if self.keys[right].time as f64 == time {
            return Ok(self.keys[right].value);
        }
        let index = right - 1;
        let left = &self.keys[index];
        let right = &self.keys[right];
        match left.segment {
            Segment::Step => Ok(left.value),
            Segment::Linear => {
                let progress =
                    ((time - left.time as f64) / (right.time - left.time) as f64).clamp(0.0, 1.0);
                finite(left.value + (right.value - left.value) * progress, index)
            }
            Segment::Bezier => {
                let curve = self.curve(index)?;
                if let Some(value) = curve.constant() {
                    return Ok(value);
                }
                let mut lower = 0.0;
                let mut upper = 1.0;
                for _ in 0..SOLVE_ITERATIONS {
                    let mid = (lower + upper) / 2.0;
                    if bernstein(mid, curve.x) < time {
                        lower = mid
                    } else {
                        upper = mid
                    }
                }
                finite(bernstein((lower + upper) / 2.0, curve.y), index)
            }
        }
    }

    pub(crate) fn edge(&self, time: f64, edge: usize, neighbor: usize, mode: Extrapolation) -> f64 {
        let edge = &self.keys[edge];
        if mode == Extrapolation::Hold {
            return edge.value;
        }
        let neighbor = &self.keys[neighbor];
        edge.value
            + ((time - edge.time as f64) / (neighbor.time as f64 - edge.time as f64))
                * (neighbor.value - edge.value)
    }

    pub(crate) fn curve(&self, index: usize) -> Result<Curve, NumericIssue> {
        let left = &self.keys[index];
        let right = &self.keys[index + 1];
        let span = (right.time - left.time) as f64;
        let right_dt = left
            .right
            .map_or(span / 3.0, |h| (h.dt as f64).clamp(0.0, span));
        let left_dt = right
            .left
            .map_or(-span / 3.0, |h| (h.dt as f64).clamp(-span, 0.0));
        let right_dv = left
            .right
            .map_or_else(|| (right.value - left.value) / 3.0, |h| h.dv);
        let left_dv = right
            .left
            .map_or_else(|| -(right.value - left.value) / 3.0, |h| h.dv);
        let curve = Curve {
            x: [
                left.time as f64,
                left.time as f64 + right_dt,
                right.time as f64 + left_dt,
                right.time as f64,
            ],
            y: [
                left.value,
                left.value + right_dv,
                right.value + left_dv,
                right.value,
            ],
        };
        if curve
            .x
            .iter()
            .chain(curve.y.iter())
            .any(|value| !value.is_finite())
        {
            return Err(NumericIssue::new(
                IssueKind::NonFiniteArithmetic,
                Some(index),
            ));
        }
        Ok(curve)
    }
}

pub(crate) fn finite(value: f64, index: usize) -> Result<f64, NumericIssue> {
    if value.is_finite() {
        Ok(value)
    } else {
        Err(NumericIssue::new(
            IssueKind::NonFiniteArithmetic,
            Some(index),
        ))
    }
}

pub(crate) struct Curve {
    pub x: [f64; 4],
    pub y: [f64; 4],
}

impl Curve {
    pub fn constant(&self) -> Option<f64> {
        self.y
            .iter()
            .all(|value| *value == self.y[0])
            .then_some(self.y[0])
    }
}

pub(crate) fn bernstein(u: f64, p: [f64; 4]) -> f64 {
    let mt = 1.0 - u;
    mt * mt * mt * p[0] + 3.0 * mt * mt * u * p[1] + 3.0 * mt * u * u * p[2] + u * u * u * p[3]
}

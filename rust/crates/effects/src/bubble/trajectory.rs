pub const TICKS_PER_SECOND: u64 = 120_000;
pub const MAX_SAFE_TICKS: u64 = 9_007_199_254_740_991;
pub const MAX_POINTS: usize = 16;
pub const MAX_BALLS: u32 = 24;

#[derive(Clone, Copy, Debug)]
pub struct Point {
    pub ticks: u64,
    pub position: [f64; 2],
}

#[derive(Clone, Copy, Debug)]
pub struct Config {
    pub start_ticks: u64,
    pub duration_ticks: u64,
    pub follow: f64,
    pub trail: u32,
    pub trail_duration_ticks: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Error {
    InvalidActivity,
    InvalidFollow,
    InvalidTrail,
    InvalidPointCount,
    InvalidPointTime,
    InvalidPosition,
    InvalidSampleTime,
}

#[derive(Debug, PartialEq)]
pub struct Frame {
    pub elapsed_ticks: u64,
    pub centers: Vec<[f64; 2]>,
    pub segment_visits: u16,
}

/// Immutable schedule. All elapsed history is evaluated from its timestamped
/// segments; there is no cache that could depend on seek order or export FPS.
pub struct Trajectory {
    config: Config,
    points: Vec<Point>,
    response: f64,
}

impl Trajectory {
    pub fn new(config: Config, points: &[Point]) -> Result<Self, Error> {
        if config.start_ticks > MAX_SAFE_TICKS
            || !(1_000..=3_600_000).contains(&config.duration_ticks)
            || config
                .start_ticks
                .checked_add(config.duration_ticks)
                .is_none_or(|end| end > MAX_SAFE_TICKS)
        {
            return Err(Error::InvalidActivity);
        }
        if !config.follow.is_finite() || !(0.0..=1.0).contains(&config.follow) {
            return Err(Error::InvalidFollow);
        }
        if !(1..=MAX_BALLS).contains(&config.trail)
            || config.trail_duration_ticks > TICKS_PER_SECOND
        {
            return Err(Error::InvalidTrail);
        }
        if points.is_empty() || points.len() > MAX_POINTS {
            return Err(Error::InvalidPointCount);
        }
        for (index, point) in points.iter().enumerate() {
            if (index == 0 && point.ticks != 0)
                || point.ticks > config.duration_ticks
                || (index > 0 && points[index - 1].ticks >= point.ticks)
            {
                return Err(Error::InvalidPointTime);
            }
            if point
                .position
                .iter()
                .any(|v| !v.is_finite() || !(-1.0..=2.0).contains(v))
            {
                return Err(Error::InvalidPosition);
            }
        }
        let response = if config.follow > 0.0 && config.follow < 1.0 {
            -60.0 * (-config.follow).ln_1p()
        } else {
            0.0
        };
        Ok(Self {
            config,
            points: points.to_vec(),
            response,
        })
    }

    /// The caller supplies the already frame-quantized clip-local tick. Source
    /// trim and timeline offset must not be folded into this schedule again.
    pub fn sample(&self, sampled_ticks: i64) -> Result<Option<Frame>, Error> {
        if sampled_ticks.unsigned_abs() > MAX_SAFE_TICKS {
            return Err(Error::InvalidSampleTime);
        }
        let elapsed = i128::from(sampled_ticks) - i128::from(self.config.start_ticks);
        if elapsed < 0 || elapsed >= i128::from(self.config.duration_ticks) {
            return Ok(None);
        }
        let denominator = u64::from(self.config.trail.saturating_sub(1).max(1));
        let mut centers = Vec::with_capacity(self.config.trail as usize);
        let mut segment_visits = 0;
        for index in 0..self.config.trail {
            // Form the lag in wide integer ticks before converting any delta
            // to f64, retaining fractional delays and large absolute starts.
            let numerator = (elapsed * i128::from(denominator)
                - i128::from(index) * i128::from(self.config.trail_duration_ticks))
            .max(0);
            centers.push(self.head(numerator as u64, denominator, &mut segment_visits));
        }
        debug_assert!(usize::from(segment_visits) <= MAX_POINTS * MAX_BALLS as usize);
        Ok(Some(Frame {
            elapsed_ticks: elapsed as u64,
            centers,
            segment_visits,
        }))
    }

    fn head(&self, numerator: u64, denominator: u64, visits: &mut u16) -> [f64; 2] {
        let mut head = self.points[0].position;
        if self.config.follow == 0.0 || numerator == 0 {
            return head;
        }
        for (index, point) in self.points.iter().enumerate() {
            let start = point.ticks * denominator;
            if numerator <= start {
                break;
            }
            *visits += 1;
            let next = self.points.get(index + 1);
            let end = next.map_or(numerator, |p| numerator.min(p.ticks * denominator));
            let span = (end - start) as f64 / denominator as f64;
            let travel = next.map_or([0.0; 2], |p| {
                let progress = span / (p.ticks - point.ticks) as f64;
                [0, 1].map(|axis| (p.position[axis] - point.position[axis]) * progress)
            });
            if self.config.follow == 1.0 {
                head = next.filter(|p| end == p.ticks * denominator).map_or_else(
                    || [0, 1].map(|axis| point.position[axis] + travel[axis]),
                    |p| p.position,
                );
            } else {
                let x = self.response * (span / TICKS_PER_SECOND as f64);
                let g = -(-x).exp_m1();
                let ramp = ramp_response(x, g);
                head = [0, 1].map(|axis| {
                    head[axis] + (point.position[axis] - head[axis]) * g + travel[axis] * ramp
                });
            }
            if end == numerator {
                break;
            }
        }
        head
    }
}

// 1 - (1-exp(-x))/x loses its significant bits for a slow response or a short
// segment. This series is for arithmetic stability, not a temporal threshold.
fn ramp_response(x: f64, g: f64) -> f64 {
    if x < 1.0e-4 {
        x * (0.5 + x * (-1.0 / 6.0 + x * (1.0 / 24.0 + x * (-1.0 / 120.0 + x / 720.0))))
    } else {
        1.0 - g / x
    }
}

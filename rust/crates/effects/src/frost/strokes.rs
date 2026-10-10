pub const MAX_FROST_STROKES: usize = 16;
pub const MAX_FROST_TICKS: u64 = 9_007_199_254_740_991;

#[derive(Clone, Debug)]
pub(super) struct Stroke {
    pub time: u64,
    pub from: [f64; 2],
    pub to: [f64; 2],
    pub radius: f64,
    pub strength: f64,
}
impl Stroke {
    // Timestamps are instantaneous brush commits on the floored frame grid.
    // No state/cache/wall clock is involved, so arbitrary seek order is safe.
    pub fn strength_at(&self, ticks: i64, hold: u64, recovery: u64) -> f64 {
        let age = i128::from(ticks) - i128::from(self.time);
        if age < 0 || age >= i128::from(hold) + i128::from(recovery) {
            return 0.0;
        }
        if age <= i128::from(hold) {
            return self.strength;
        }
        self.strength * (1.0 - (age - i128::from(hold)) as f64 / recovery as f64)
    }
}

#[cfg(test)]
pub(super) fn capsule_melt(
    point: [f64; 2],
    from: [f64; 2],
    to: [f64; 2],
    radius: f64,
    strength: f64,
) -> f64 {
    let delta = [to[0] - from[0], to[1] - from[1]];
    let length_squared = delta[0] * delta[0] + delta[1] * delta[1];
    let projection = if length_squared == 0.0 {
        0.0
    } else {
        ((point[0] - from[0]) * delta[0] + (point[1] - from[1]) * delta[1]) / length_squared
    }
    .clamp(0.0, 1.0);
    let distance = ((point[0] - from[0] - projection * delta[0]).powi(2)
        + (point[1] - from[1] - projection * delta[1]).powi(2))
    .sqrt();
    let progress = ((distance / radius - 0.6) / 0.4).clamp(0.0, 1.0);
    strength * (1.0 - progress * progress * (3.0 - 2.0 * progress))
}

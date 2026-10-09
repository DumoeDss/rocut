use crate::mv_recipe::catalog::NumberRule;
pub(super) use crate::mv_recipe::catalog::OPACITY;
const fn rule(min: f64, max: f64, suggested: f64) -> NumberRule {
    NumberRule {
        min,
        max,
        suggested,
        integer: false,
    }
}
pub(super) const POSITION: NumberRule = rule(-2.0, 3.0, 0.5);
pub(super) const SIZE: NumberRule = rule(0.001, 2.0, 0.04);
pub(super) const EXTENT: NumberRule = rule(0.001, 4.0, 0.5);
pub(super) const RADIUS: NumberRule = rule(0.001, 6.0, 1.0);
pub(super) const STROKE: NumberRule = rule(0.0001, 0.1, 0.0014);
pub(super) const TRACKING: NumberRule = rule(-0.1, 0.2, 0.004);
pub(super) const OFFSET: NumberRule = rule(-2.0, 2.0, 0.04);
pub(super) const GAP: NumberRule = rule(0.0, 2.0, 0.36);
pub(super) const SCALE: NumberRule = rule(0.1, 2.0, 1.0);
pub(super) const LENGTH_SCALE: NumberRule = rule(0.0, 2.0, 0.66);
pub(super) const PADDING: NumberRule = rule(0.0, 2.0, 0.03);
pub(super) const LEAD: NumberRule = rule(0.0, 30.0, 0.1);
pub(super) const STAGGER: NumberRule = rule(0.0, 2.0, 0.12);
pub(super) const FADE: NumberRule = rule(0.001, 30.0, 0.6);
pub(super) const HOLD: NumberRule = rule(0.001, 30.0, 0.2);
pub(super) const MAX_GLYPHS: usize = 128;
pub(super) const MAX_TEXT: usize = 256;
pub(super) const MAX_PARTS: usize = 4;
pub(super) const MAX_BEATS: usize = 4096;
pub(super) const MAX_MORSE: usize = 64;
pub(super) const MAX_SAFE_TICKS: u64 = 9_007_199_254_740_991;

pub(super) fn text(value: &str, max: usize) -> bool {
    value.len() <= max * 4
        && (1..=max).contains(&value.chars().count())
        && value.chars().all(|c| !c.is_control())
}
pub(super) fn id(value: &str) -> bool {
    !value.is_empty() && value.len() <= 240
}
pub(super) fn point(p: &[f64; 2]) -> bool {
    p.iter().all(|v| POSITION.valid(*v))
}
pub(super) fn rect(r: &[f64; 4]) -> bool {
    r[..2].iter().all(|v| POSITION.valid(*v)) && r[2..].iter().all(|v| EXTENT.valid(*v))
}

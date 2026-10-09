use super::model::Span;
use serde::Deserialize;

/// Piecewise-linear map on integer source frames. Outside knots hold endpoints.
/// Repeated sourceFrame values freeze; descending values rewind. No JS clocks.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TimePoint {
    pub at_frame: u32,
    pub source_frame: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SequenceItem {
    pub input: String,
    pub span: Span,
    pub time_map: Vec<TimePoint>,
}

pub fn valid_map(map: &[TimePoint], frames: u32) -> bool {
    !map.is_empty()
        && map.len() <= 256
        && map
            .iter()
            .all(|p| p.at_frame < frames && p.source_frame < frames)
        && map.windows(2).all(|p| p[0].at_frame < p[1].at_frame)
}

pub fn sample(map: &[TimePoint], frame: u64) -> u64 {
    let next = map.partition_point(|p| u64::from(p.at_frame) <= frame);
    if next == 0 {
        return u64::from(map[0].source_frame);
    }
    let a = &map[next - 1];
    if next == map.len() {
        return u64::from(a.source_frame);
    }
    let b = &map[next];
    let len = u64::from(b.at_frame - a.at_frame);
    let offset = frame - u64::from(a.at_frame);
    // A weighted nonnegative numerator handles reverse rates without signed
    // truncation errors or floating-point floors at rational boundaries.
    (u64::from(a.source_frame) * (len - offset) + u64::from(b.source_frame) * offset) / len
}

pub fn valid_sequence(items: &[SequenceItem], frames: u32) -> bool {
    !items.is_empty()
        && items.len() <= 64
        && items
            .iter()
            .all(|s| super::validate::span(&s.span, frames) && valid_map(&s.time_map, frames))
        && items
            .windows(2)
            .all(|p| p[0].span.start_frame + p[0].span.duration_frames <= p[1].span.start_frame)
}

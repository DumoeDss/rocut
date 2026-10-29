use super::model::*;
use serde_json::Value;
use std::collections::BTreeSet;

/// Quarter-note BPM, explicit whole-note beat unit; round each absolute rational
/// boundary once (ties earlier), never accumulate rounded beat durations.
pub fn generate(input: &Value, duration: i64) -> Result<(Vec<Point>, Vec<MeterSegment>), String> {
    let entries = input
        .as_array()
        .filter(|v| !v.is_empty() && v.len() <= 1000)
        .ok_or("music-grid-bpm-segments-invalid")?;
    let mut points = vec![];
    let mut segments: Vec<MeterSegment> = vec![];
    let mut ids = BTreeSet::new();
    for entry in entries {
        let mut value = entry
            .as_object()
            .cloned()
            .ok_or("music-grid-bpm-segment-invalid")?;
        let bpm: Rational = serde_json::from_value(
            value
                .remove("quarterNoteBpm")
                .ok_or("music-grid-bpm-required")?,
        )
        .map_err(|_| "music-grid-bpm-invalid")?;
        if value.remove("interpolation") != Some(Value::String("step".into())) {
            return Err("music-grid-tempo-interpolation-unavailable".into());
        }
        let segment: MeterSegment = serde_json::from_value(Value::Object(value))
            .map_err(|_| "music-grid-meter-segment-invalid")?;
        if !bpm.valid()
            || bpm.numerator <= 0
            || !segment.validate(duration)
            || !ids.insert(segment.id.clone())
            || segments
                .last()
                .is_some_and(|last| last.source_end_tick > segment.source_start_tick)
        {
            return Err("music-grid-bpm-segment-invalid".into());
        }
        // step = 60 * 120000 / quarterNoteBpm * wholeNoteBeatUnit * 4
        let step_num = 7_200_000_i128
            * i128::from(bpm.denominator)
            * 4
            * i128::from(segment.beat_unit.numerator);
        let step_den = i128::from(bpm.numerator) * i128::from(segment.beat_unit.denominator);
        if step_num < step_den {
            return Err("music-grid-bpm-subtick-unavailable".into());
        }
        for index in 0..=100_000_i128 {
            let elapsed = index * step_num;
            if elapsed >= i128::from(segment.source_end_tick - segment.source_start_tick) * step_den
            {
                break;
            }
            if points.len() >= 100_000 {
                return Err("music-grid-point-limit".into());
            }
            let floor = elapsed / step_den;
            let tick = i128::from(segment.source_start_tick)
                + floor
                + i128::from((elapsed % step_den) * 2 > step_den);
            if tick >= i128::from(segment.source_end_tick) {
                break;
            }
            let phase_num = i128::from(segment.phase_quarter_notes.numerator)
                * i128::from(segment.beat_unit.denominator)
                + index
                    * 4
                    * i128::from(segment.beat_unit.numerator)
                    * i128::from(segment.phase_quarter_notes.denominator);
            let phase_den = i128::from(segment.phase_quarter_notes.denominator)
                * i128::from(segment.beat_unit.denominator);
            let is_downbeat = (phase_num * i128::from(segment.meter.denominator))
                % (phase_den * i128::from(segment.meter.numerator) * 4)
                == 0;
            points.push(Point {
                id: format!("{}:beat-{index}", segment.id),
                source_tick: i64::try_from(tick).map_err(|_| "music-grid-bpm-overflow")?,
                downbeat: Some(is_downbeat),
            });
        }
        segments.push(segment);
    }
    if !points_valid(&points, duration) {
        return Err("music-grid-generated-points-invalid".into());
    }
    Ok((points, segments))
}

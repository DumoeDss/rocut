//! Canvas authoring admission followed by shared native time evaluation.
//! This module does not duplicate frame division or rounding algorithms.
use time::{FrameRate, MediaTime};

pub fn frame_floor(ticks: i64, numerator: u32, denominator: u32) -> Result<i64, &'static str> {
    // Narrow Canvas policy, not a limitation claimed for the shared time API.
    if ticks.unsigned_abs() > 9_007_199_254_740_991
        || numerator == 0
        || numerator > 120_000
        || denominator == 0
        || denominator > 1001
    {
        return Err("invalid Canvas time or frame rate");
    }
    let rate = FrameRate::new(numerator, denominator);
    rate.ticks_per_frame()
        .ok_or("Canvas frame rate requires integral ticks/frame")?;
    MediaTime::from_ticks(ticks)
        .floor_to_frame(rate)
        .map(MediaTime::as_ticks)
        .ok_or("Canvas frame rate requires integral ticks/frame")
}

#[cfg(test)]
mod tests {
    use super::frame_floor;
    use time::{FrameRate, MediaTime};

    #[test]
    fn off_grid_and_negative_times_use_shared_floor() {
        for (ticks, expected) in [
            (0, 0),
            (3999, 0),
            (4000, 4000),
            (7999, 4000),
            (-1, -4000),
            (-4000, -4000),
            (-4001, -8000),
        ] {
            assert_eq!(frame_floor(ticks, 30, 1), Ok(expected));
            assert_eq!(
                frame_floor(ticks, 30, 1),
                MediaTime::from_ticks(ticks)
                    .floor_to_frame(FrameRate::FPS_30)
                    .map(MediaTime::as_ticks)
                    .ok_or("unsupported")
            );
        }
    }

    #[test]
    fn rational_rate_uses_actual_shared_api() {
        assert_eq!(FrameRate::new(30000, 1001).ticks_per_frame(), Some(4004));
        assert_eq!(frame_floor(12003, 30000, 1001), Ok(8008));
        assert_eq!(frame_floor(12012, 30000, 1001), Ok(12012));
        assert_eq!(frame_floor(-1, 30000, 1001), Ok(-4004));
    }

    #[test]
    fn unsupported_integral_frame_rate_is_rejected_by_shared_api() {
        assert_eq!(FrameRate::new(90, 1).ticks_per_frame(), None);
        assert_eq!(
            frame_floor(1, 90, 1),
            Err("Canvas frame rate requires integral ticks/frame")
        );
    }

    #[test]
    fn safe_js_and_authoring_rate_bounds_remain_explicit() {
        for ticks in [
            i64::MIN,
            i64::MAX,
            9_007_199_254_740_992,
            -9_007_199_254_740_992,
        ] {
            assert_eq!(
                frame_floor(ticks, 30, 1),
                Err("invalid Canvas time or frame rate")
            );
        }
        for rate in [(0, 1), (30, 0), (120001, 1), (30, 1002)] {
            assert_eq!(
                frame_floor(0, rate.0, rate.1),
                Err("invalid Canvas time or frame rate")
            );
        }
        assert_eq!(
            frame_floor(9_007_199_254_740_991, 120000, 1),
            Ok(9_007_199_254_740_991)
        );
        assert_eq!(
            frame_floor(-9_007_199_254_740_991, 120000, 1),
            Ok(-9_007_199_254_740_991)
        );
        // Shared API accepts this integral rate; Canvas authoring intentionally does not.
        assert_eq!(FrameRate::new(240000, 2).ticks_per_frame(), Some(1));
        assert!(frame_floor(0, 240000, 2).is_err());
    }
}

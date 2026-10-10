use time::TICKS_PER_SECOND;

pub(crate) fn phase(sample_ticks: i64, speed: f64) -> f32 {
    if speed == 0.0 || sample_ticks == 0 {
        return 0.0;
    }
    let bits = speed.to_bits();
    let exponent = ((bits >> 52) & 0x7ff) as i32;
    let fraction = bits & ((1_u64 << 52) - 1);
    let (mantissa, shift) = if exponent == 0 {
        (fraction, 1074)
    } else {
        (fraction | (1_u64 << 52), 1075 - exponent)
    };
    // Safe ticks and speed <= 4 bound both i128 products. Reduce the exact
    // binary speed before converting large signed frame times to GPU f32.
    let value = if shift <= 110 {
        let numerator = i128::from(sample_ticks) * i128::from(mantissa);
        let denominator = i128::from(TICKS_PER_SECOND) * (1_i128 << shift);
        numerator.rem_euclid(denominator) as f64 / denominator as f64
    } else {
        // The absolute cycle count is < 1 here, including subnormal speed.
        (sample_ticks as f64 / TICKS_PER_SECOND as f64 * speed).rem_euclid(1.0)
    } as f32;
    if value >= 1.0 { 0.0 } else { value }
}

#[cfg(test)]
mod tests {
    use super::phase;
    use std::collections::BTreeMap;
    use time::{FrameRate, TICKS_PER_SECOND};

    #[test]
    fn shared_phase_preserves_signed_binary_rational_golden_values() {
        for (ticks, speed, expected) in [
            (TICKS_PER_SECOND / 4, 1.0, 0.25),
            (-TICKS_PER_SECOND / 4, 1.0, 0.75),
            (2_400_000, 0.4, 4.440892098500626e-16),
            (9_007_199_254_740_000, 0.4, 0.8000016808509827),
            (-4004, 0.4, 0.9866533279418945),
            (TICKS_PER_SECOND, 0.99999999, 0.0),
        ] {
            assert_eq!(phase(ticks, speed), expected as f32);
        }
    }

    #[test]
    fn both_resolvers_use_shared_phase_on_signed_floor_frames_and_frozen_speed() {
        let rate = FrameRate {
            numerator: 30000,
            denominator: 1001,
        };
        for (ticks, speed, expected) in [
            (-1, 0.4, 0.9866533279418945),
            (-4004, 0.4, 0.9866533279418945),
            (9_007_199_254_740_991, 0.0, 0.0),
            (-9_007_199_254_740_991, 0.0, 0.0),
            (9_007_199_254_740_991, f64::from_bits(1), 0.0),
        ] {
            let params = BTreeMap::from([("speed".into(), speed)]);
            let blaze = crate::blaze::resolve(&params, ticks, rate).unwrap();
            let wrap = crate::flame_wrap::resolve(&params, ticks, rate).unwrap();
            assert_eq!(blaze["frameIndex"], wrap["frameIndex"]);
            for plan in [blaze, wrap] {
                assert_eq!(
                    plan["passes"][0]["uniforms"]["phase"].as_f64().unwrap(),
                    f64::from(expected as f32)
                );
            }
        }
    }

    #[test]
    fn both_resolvers_keep_speed_and_safe_tick_admission_strict() {
        let rate = FrameRate {
            numerator: 30,
            denominator: 1,
        };
        for speed in [-f64::MIN_POSITIVE, 4.0001, f64::NAN, f64::INFINITY] {
            let params = BTreeMap::from([("speed".into(), speed)]);
            assert!(crate::blaze::resolve(&params, 0, rate).is_err());
            assert!(crate::flame_wrap::resolve(&params, 0, rate).is_err());
        }
        for ticks in [-9_007_199_254_740_992, 9_007_199_254_740_992] {
            assert!(crate::blaze::resolve(&BTreeMap::new(), ticks, rate).is_err());
            assert!(crate::flame_wrap::resolve(&BTreeMap::new(), ticks, rate).is_err());
        }
    }
}

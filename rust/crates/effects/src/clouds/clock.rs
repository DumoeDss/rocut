use time::TICKS_PER_SECOND;

pub(super) fn phase(sample_ticks: i64, speed: f64) -> f32 {
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
    // Validated speed <= 4 gives shift >= 50. Reduce the binary rational
    // before converting signed large times to a GPU scalar.
    let value = if shift <= 110 {
        let numerator = i128::from(sample_ticks) * i128::from(mantissa);
        let denominator = i128::from(TICKS_PER_SECOND) * (1_i128 << shift);
        numerator.rem_euclid(denominator) as f64 / denominator as f64
    } else {
        // At this magnitude |cycles| < 1, including subnormal speeds.
        (sample_ticks as f64 / TICKS_PER_SECOND as f64 * speed).rem_euclid(1.0)
    } as f32;
    if value >= 1.0 { 0.0 } else { value }
}

#[cfg(test)]
mod tests {
    use time::{FrameRate, MediaTime};

    #[test]
    fn clouds_clock_matches_independent_binary_rational_vectors() {
        // IEEE754 .05 is 3602879701896397 / 2^56, not exactly 1/20.
        for (ticks, rate, sampled, expected) in [
            (
                2_400_000,
                FrameRate::FPS_30,
                2_400_000,
                5.551115123125783e-17,
            ),
            (
                9_007_199_254_740_991,
                FrameRate::FPS_30,
                9_007_199_254_740_000,
                0.47500020265579224,
            ),
            (
                -9_007_199_254_740_991,
                FrameRate::FPS_30,
                -9_007_199_254_744_000,
                0.5233331322669983,
            ),
            (
                9_007_199_254_740_991,
                FrameRate::FPS_29_97,
                9_007_199_254_737_684,
                0.47403520345687866,
            ),
            (-1, FrameRate::FPS_29_97, -4004, 0.9983316659927368),
        ] {
            let frame = MediaTime::from_ticks(ticks).to_frame_floor(rate).unwrap();
            let sample = MediaTime::from_frame(frame, rate).unwrap().as_ticks();
            assert_eq!(sample, sampled);
            assert_eq!(super::phase(sample, 0.05), expected as f32);
        }
    }
}

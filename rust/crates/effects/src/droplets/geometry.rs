use time::TICKS_PER_SECOND;

use super::MAX_DROPLETS;

pub(super) fn time_phase(sample_ticks: i64, speed: f64) -> f64 {
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
    // The validated speed is <= 4, hence shift >= 50. For shift <= 110,
    // both products fit i128, including floored negative safe-tick handles.
    // Reduce the exact binary speed before converting any large time to f64.
    let phase = if shift <= 110 {
        let numerator = i128::from(sample_ticks) * i128::from(mantissa);
        let denominator = i128::from(TICKS_PER_SECOND) * (1_i128 << shift);
        numerator.rem_euclid(denominator) as f64 / denominator as f64
    } else {
        // Here |cycles| < 1, so no large integer phase is lost. This also
        // covers subnormal speeds without constructing an oversized shift.
        (sample_ticks as f64 / TICKS_PER_SECOND as f64 * speed).rem_euclid(1.0)
    };
    if phase >= 1.0 { 0.0 } else { phase }
}

fn unit(seed: u32, index: u32, salt: u32) -> f64 {
    let mut hash = seed ^ (index + 1).wrapping_mul(0x9e37_79b9) ^ salt;
    hash = (hash ^ (hash >> 16)).wrapping_mul(0x7feb_352d);
    hash = (hash ^ (hash >> 15)).wrapping_mul(0x846c_a68b);
    hash ^= hash >> 16;
    f64::from(hash >> 8) / 16_777_216.0
}

pub(super) fn drops(
    count: usize,
    seed: u32,
    radius: f32,
    elongation: f32,
    phase: f32,
) -> [[f32; 4]; MAX_DROPLETS] {
    let mut result = [[0.0; 4]; MAX_DROPLETS];
    for (index, drop) in result.iter_mut().take(count).enumerate() {
        let index = index as u32;
        *drop = [
            unit(seed, index, 0xa511_e9b3) as f32,
            (unit(seed, index, 0x63d8_3595) + f64::from(phase)).rem_euclid(1.0) as f32,
            (f64::from(radius) * (0.75 + 0.5 * unit(seed, index, 0xb529_7a4d))) as f32,
            elongation,
        ];
    }
    result
}

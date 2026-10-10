pub(super) const FIELD_VECTORS: usize = 64;
pub(super) const SPARKS: usize = 24;

fn unit(seed: u32, index: u32, salt: u32) -> f64 {
    let mut hash = seed ^ (index + 1).wrapping_mul(0x9e37_79b9) ^ salt;
    hash = (hash ^ (hash >> 16)).wrapping_mul(0x7feb_352d);
    hash = (hash ^ (hash >> 15)).wrapping_mul(0x846c_a68b);
    hash ^= hash >> 16;
    f64::from(hash >> 8) / 16_777_216.0
}

pub(super) fn lattice(seed: u32) -> [[f32; 4]; FIELD_VECTORS] {
    let mut result = [[0.0; 4]; FIELD_VECTORS];
    for (index, value) in result.iter_mut().flatten().enumerate() {
        *value = unit(seed, index as u32, 0x3c6e_f372) as f32;
    }
    result
}

pub(super) fn sparks(seed: u32, phase: f32) -> [[f32; 4]; SPARKS] {
    let mut result = [[0.0; 4]; SPARKS];
    for (index, spark) in result.iter_mut().enumerate() {
        let index = index as u32;
        let age = (unit(seed, index, 0x63d8_3595) + f64::from(phase)).rem_euclid(1.0) as f32;
        *spark = [
            unit(seed, index, 0xa511_e9b3) as f32,
            if age >= 1.0 { 0.0 } else { age },
            (0.003 + 0.004 * unit(seed, index, 0xb529_7a4d)) as f32,
            (2.0 * unit(seed, index, 0x1b56_c4e9) - 1.0) as f32,
        ];
    }
    result
}

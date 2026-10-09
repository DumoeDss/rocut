pub(super) const FIELD_VECTORS: usize = 256;

pub(super) fn lattice(seed: u32) -> [[f32; 4]; FIELD_VECTORS] {
    let mut values = [[0.0; 4]; FIELD_VECTORS];
    for (index, value) in values.iter_mut().flatten().enumerate() {
        let mut hash = seed ^ (index as u32 + 1).wrapping_mul(0x9e37_79b9) ^ 0x68bc_21eb;
        hash = (hash ^ (hash >> 16)).wrapping_mul(0x7feb_352d);
        hash = (hash ^ (hash >> 15)).wrapping_mul(0x846c_a68b);
        hash ^= hash >> 16;
        *value = (hash >> 8) as f32 / 16_777_216.0;
    }
    values
}

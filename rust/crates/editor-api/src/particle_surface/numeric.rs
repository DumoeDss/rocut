use super::SurfaceError;

#[cfg(test)]
#[path = "numeric_tests.rs"]
mod tests;

#[derive(Clone, Copy, Debug)]
pub(super) struct ScaledArea {
    pub mantissa: f64,
    pub exponent: i32,
}

/// Returns a base-two exponent even for subnormal, nonzero finite values.
fn exponent(value: f64) -> i32 {
    let bits = value.abs().to_bits();
    let encoded = ((bits >> 52) & 0x7ff) as i32;
    if encoded == 0 {
        63 - bits.leading_zeros() as i32 - 1074
    } else {
        encoded - 1023
    }
}

pub(super) fn scale_pow2(mut value: f64, mut shift: i32) -> f64 {
    while shift > 1023 {
        value *= f64::from_bits(2046_u64 << 52);
        shift -= 1023;
    }
    while shift < -1022 {
        value *= f64::MIN_POSITIVE;
        shift += 1022;
    }
    value * f64::from_bits(((shift + 1023) as u64) << 52)
}

fn range_error(index: usize, message: &str) -> SurfaceError {
    SurfaceError::numeric(format!("triangles[{index}].position"), message)
}

fn scaled_edge(
    from: [f64; 3],
    to: [f64; 3],
    index: usize,
) -> Result<([f64; 3], i32), SurfaceError> {
    let mut edge = std::array::from_fn::<_, 3, _>(|axis| to[axis] - from[axis]);
    let half = edge.iter().any(|value| !value.is_finite());
    if half {
        for axis in 0..3 {
            let original = edge[axis];
            edge[axis] = if original.is_finite() {
                original * 0.5
            } else {
                to[axis] * 0.5 - from[axis] * 0.5
            };
            if original != 0.0 && edge[axis] == 0.0 {
                return Err(range_error(
                    index,
                    "Edge component underflows while avoiding coordinate subtraction overflow",
                ));
            }
        }
    }
    let maximum = edge
        .iter()
        .fold(0.0_f64, |maximum, value| maximum.max(value.abs()));
    if maximum == 0.0 {
        return Ok((edge, 0));
    }
    let edge_exponent = exponent(maximum);
    for value in &mut edge {
        let scaled = scale_pow2(*value, -edge_exponent);
        if *value != 0.0 && scaled == 0.0 {
            return Err(range_error(
                index,
                "Edge component dynamic range cannot be represented",
            ));
        }
        *value = scaled;
    }
    Ok((edge, edge_exponent + i32::from(half)))
}

fn determinant(a: f64, b: f64, c: f64, d: f64, index: usize) -> Result<f64, SurfaceError> {
    let ab = a * b;
    let cd = c * d;
    let product_underflows = (a != 0.0 && b != 0.0 && ab.abs() < f64::MIN_POSITIVE)
        || (c != 0.0 && d != 0.0 && cd.abs() < f64::MIN_POSITIVE);
    let error = (-c).mul_add(d, cd);
    let result = a.mul_add(b, -cd) + error;
    if product_underflows || result == 0.0 {
        // Normal products can cancel below the subnormal range, losing even
        // the fused residual. Distinguish exact zero using integer arithmetic:
        // two 53-bit significands fit their exact product into u128.
        if exact_product(a, b) == exact_product(c, d) {
            return Ok(0.0);
        }
        return Err(range_error(
            index,
            "Nonzero cross-product component underflows at this aspect ratio",
        ));
    }
    Ok(result)
}

/// Canonical sign, odd integer significand and power of two for an exact
/// product of finite f64 values. None represents either sign of exact zero.
fn exact_product(a: f64, b: f64) -> Option<(bool, u128, i32)> {
    if a == 0.0 || b == 0.0 {
        return None;
    }
    fn parts(value: f64) -> (u64, i32) {
        let bits = value.to_bits();
        let fraction = bits & ((1_u64 << 52) - 1);
        let encoded = ((bits >> 52) & 0x7ff) as i32;
        if encoded == 0 {
            (fraction, -1074)
        } else {
            (fraction | (1_u64 << 52), encoded - 1023 - 52)
        }
    }
    let (a_significand, a_exponent) = parts(a);
    let (b_significand, b_exponent) = parts(b);
    let product = u128::from(a_significand) * u128::from(b_significand);
    let shift = product.trailing_zeros();
    Some((
        a.is_sign_negative() ^ b.is_sign_negative(),
        product >> shift,
        a_exponent + b_exponent + shift as i32,
    ))
}

pub(super) fn triangle_geometry(
    position: &[[f64; 3]; 3],
    index: usize,
) -> Result<Option<(ScaledArea, [f64; 3])>, SurfaceError> {
    let (a, a_exponent) = scaled_edge(position[0], position[1], index)?;
    let (b, b_exponent) = scaled_edge(position[0], position[2], index)?;
    let cross = [
        determinant(a[1], b[2], a[2], b[1], index)?,
        determinant(a[2], b[0], a[0], b[2], index)?,
        determinant(a[0], b[1], a[1], b[0], index)?,
    ];
    let maximum = cross
        .iter()
        .fold(0.0_f64, |maximum, value| maximum.max(value.abs()));
    if maximum == 0.0 {
        return Ok(None);
    }
    let cross_exponent = exponent(maximum);
    let scaled = cross.map(|value| scale_pow2(value, -cross_exponent));
    let length = scaled.iter().map(|value| value * value).sum::<f64>().sqrt();
    let length_exponent = exponent(length);
    let area = ScaledArea {
        mantissa: scale_pow2(length, -length_exponent),
        exponent: a_exponent + b_exponent + cross_exponent + length_exponent - 1,
    };
    Ok(Some((area, scaled.map(|value| value / length))))
}

pub(super) fn unit_vector(vector: [f64; 3]) -> Option<[f64; 3]> {
    let maximum = vector
        .iter()
        .fold(0.0_f64, |maximum, value| maximum.max(value.abs()));
    if maximum == 0.0 || !maximum.is_finite() {
        return None;
    }
    let scaled = vector.map(|value| value / maximum);
    let length = scaled.iter().map(|value| value * value).sum::<f64>().sqrt();
    Some(scaled.map(|value| value / length))
}

fn lerp(a: f64, b: f64, weight: f64) -> f64 {
    if a == b {
        return a;
    }
    if a.is_sign_positive() == b.is_sign_positive() {
        a + (b - a) * weight
    } else {
        a * (1.0 - weight) + b * weight
    }
}

/// A nested convex interpolation avoids overflowing the sum of weighted values,
/// including positions spanning -f64::MAX to +f64::MAX.
pub(super) fn interpolate<const N: usize>(
    values: &[[f64; N]; 3],
    radial: f64,
    along_edge: f64,
) -> [f64; N] {
    std::array::from_fn(|axis| {
        lerp(
            values[0][axis],
            lerp(values[1][axis], values[2][axis], along_edge),
            radial,
        )
    })
}

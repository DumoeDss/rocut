//! Deterministic sampling of finite, world-space triangle surfaces.
//!
//! Positions and normals must already include their world transforms (normals
//! require the inverse transpose). Colors are linear RGBA in [0, 1]; this module
//! deliberately leaves material and texture evaluation to the frame source.
//! Each sample consumes three SplitMix64 words: area selection, then two uniforms
//! for square-root barycentric sampling. Input order is part of reproducibility.

use serde::{Deserialize, Serialize};
use std::mem::size_of;

mod motion;
#[cfg(test)]
mod motion_tests;
mod numeric;
#[cfg(test)]
mod tests;

pub(crate) const MAX_SURFACE_TRIANGLES: usize = 262_144;
pub(crate) const MAX_SURFACE_SAMPLES: u32 = 65_536;
pub(crate) const MAX_SURFACE_JSON_BYTES: usize = 64 * 1024 * 1024;
pub(crate) const MAX_SURFACE_WORKING_BYTES: usize = 192 * 1024 * 1024;
pub(crate) const SURFACE_FIXED_OVERHEAD_BYTES: usize = 64 * 1024;
pub(crate) const MAX_SURFACE_JSON_TOKEN_BYTES: usize = 256;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SurfaceTriangle {
    pub position: [[f64; 3]; 3],
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub normal: Option<[[f64; 3]; 3]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uv: Option<[[f64; 2]; 3]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<[[f64; 4]; 3]>,
    pub primitive_index: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub material_index: Option<u32>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SurfaceSampleRequest {
    #[serde(deserialize_with = "deserialize_triangles")]
    pub triangles: Vec<SurfaceTriangle>,
    pub count: u32,
    pub seed: u32,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "motion::deserialize_optional"
    )]
    pub motion: Option<motion::SurfaceMotion>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SurfaceSample {
    pub position: [f64; 3],
    pub normal: [f64; 3],
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uv: Option<[f64; 2]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<[f64; 4]>,
    pub barycentric: [f64; 3],
    pub triangle_index: u32,
    pub primitive_index: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub material_index: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub motion_position: Option<[f64; 3]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<f64>,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SurfaceSampleResponse {
    pub samples: Vec<SurfaceSample>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum SurfaceErrorCode {
    InvalidJson,
    InputBytes,
    TriangleCount,
    SampleCount,
    WorkingBytes,
    Allocation,
    NonFinite,
    ColorRange,
    ZeroNormal,
    NormalCancellation,
    AllDegenerate,
    NumericRange,
    OutputBytes,
    Serialization,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SurfaceError {
    pub code: SurfaceErrorCode,
    pub path: String,
    pub message: String,
}

impl SurfaceError {
    fn new(code: SurfaceErrorCode, path: impl Into<String>, message: &str) -> Self {
        Self {
            code,
            path: path.into(),
            message: message.into(),
        }
    }

    fn numeric(path: impl Into<String>, message: &str) -> Self {
        Self::new(SurfaceErrorCode::NumericRange, path, message)
    }
}

#[derive(Clone, Copy, Debug)]
struct PreparedTriangle {
    source_index: u32,
    area: numeric::ScaledArea,
    normal: [f64; 3],
    cumulative_area: f64,
}

/// The JSON adapter must use this entry point, so the original input bytes are
/// included in the peak budget while the parsed input and output coexist.
pub(crate) fn sample_surface_json(input: &str) -> Result<SurfaceSampleResponse, SurfaceError> {
    sample_surface_json_with_allocation(input, input.len())
}

/// The owned bridge passes String::capacity(), including unused reserved bytes.
pub(crate) fn sample_surface_json_with_allocation(
    input: &str,
    allocated_bytes: usize,
) -> Result<SurfaceSampleResponse, SurfaceError> {
    check_json_bytes(allocated_bytes)?;
    if allocated_bytes < input.len() {
        return Err(SurfaceError::new(
            SurfaceErrorCode::InputBytes,
            "surface",
            "Input allocation metadata cannot be smaller than the JSON length",
        ));
    }
    check_json_tokens(input)?;
    let request: SurfaceSampleRequest = serde_json::from_str(input).map_err(|error| {
        SurfaceError::new(SurfaceErrorCode::InvalidJson, "surface", &error.to_string())
    })?;
    sample_surface_with_input_bytes(&request, allocated_bytes)
}

/// The typed entry point accounts for the request Vec's actual allocation.
/// Additional caller-owned copies or serialized output are outside this budget.
pub(crate) fn sample_surface(
    request: &SurfaceSampleRequest,
) -> Result<SurfaceSampleResponse, SurfaceError> {
    sample_surface_with_input_bytes(request, 0)
}

fn sample_surface_with_input_bytes(
    request: &SurfaceSampleRequest,
    input_bytes: usize,
) -> Result<SurfaceSampleResponse, SurfaceError> {
    let motion = request
        .motion
        .as_ref()
        .map(motion::PreparedMotion::new)
        .transpose()?;
    check_budget_with_motion(
        request.triangles.len(),
        request.triangles.capacity(),
        request.count,
        input_bytes,
        motion.is_some(),
    )?;
    // At most T prepared records and N output records, with no per-triangle heap
    // allocations. Runtime is O(T + N log T); all validation runs before sampling.
    let mut prepared = Vec::new();
    prepared
        .try_reserve_exact(request.triangles.len())
        .map_err(|_| {
            SurfaceError::new(
                SurfaceErrorCode::Allocation,
                "triangles",
                "Unable to allocate triangle weights",
            )
        })?;
    for (index, triangle) in request.triangles.iter().enumerate() {
        validate_triangle(triangle, index)?;
        if let Some((area, normal)) = numeric::triangle_geometry(&triangle.position, index)? {
            prepared.push(PreparedTriangle {
                source_index: index as u32,
                area,
                normal,
                cumulative_area: 0.0,
            });
        }
    }
    let maximum_exponent = prepared
        .iter()
        .map(|triangle| triangle.area.exponent)
        .max()
        .ok_or_else(|| {
            SurfaceError::new(
                SurfaceErrorCode::AllDegenerate,
                "triangles",
                "Surface has no positive-area triangles",
            )
        })?;
    let mut total = 0.0;
    for triangle in &mut prepared {
        let weight = numeric::scale_pow2(
            triangle.area.mantissa,
            triangle.area.exponent - maximum_exponent,
        );
        let next = total + weight;
        if weight == 0.0 || !weight.is_finite() || next <= total {
            return Err(SurfaceError::numeric(
                format!("triangles[{}].position", triangle.source_index),
                "Area dynamic range cannot be represented by a strictly increasing f64 distribution",
            ));
        }
        total = next;
        triangle.cumulative_area = total;
    }

    let mut samples = Vec::new();
    samples
        .try_reserve_exact(request.count as usize)
        .map_err(|_| {
            SurfaceError::new(
                SurfaceErrorCode::Allocation,
                "count",
                "Unable to allocate surface samples",
            )
        })?;
    let mut random = SplitMix64(u64::from(request.seed));
    for sample_index in 0..request.count {
        let target = random.unit() * total;
        let selected = prepared.partition_point(|triangle| triangle.cumulative_area <= target);
        let selected = prepared.get(selected).ok_or_else(|| {
            SurfaceError::numeric(
                "triangles",
                "Area selection exceeded the representable distribution",
            )
        })?;
        let triangle = &request.triangles[selected.source_index as usize];
        let radial = random.unit().sqrt();
        let along_edge = random.unit();
        let barycentric = [
            1.0 - radial,
            radial * (1.0 - along_edge),
            radial * along_edge,
        ];
        let position = numeric::interpolate(&triangle.position, radial, along_edge);
        let normal = match &triangle.normal {
            Some(normals) => {
                let interpolated = numeric::interpolate(normals, radial, along_edge);
                numeric::unit_vector(interpolated).ok_or_else(|| SurfaceError::new(
                    SurfaceErrorCode::NormalCancellation,
                    format!("samples[{sample_index}].normal"),
                    "Interpolated vertex normals cancel to zero; no geometric fallback is applied",
                ))?
            }
            None => selected.normal,
        };
        let uv = triangle
            .uv
            .as_ref()
            .map(|values| numeric::interpolate(values, radial, along_edge));
        let color = triangle
            .color
            .as_ref()
            .map(|values| numeric::interpolate(values, radial, along_edge));
        if !position
            .iter()
            .chain(normal.iter())
            .all(|value| value.is_finite())
            || uv
                .as_ref()
                .is_some_and(|values| values.iter().any(|value| !value.is_finite()))
            || color
                .as_ref()
                .is_some_and(|values| values.iter().any(|value| !value.is_finite()))
        {
            return Err(SurfaceError::numeric(
                format!("samples[{sample_index}]"),
                "Interpolation exceeded the finite numeric range",
            ));
        }
        let (motion_position, size) = match &motion {
            Some(motion) => {
                let (moved, size) = motion.apply(position, request.seed, sample_index)?;
                (Some(moved), Some(size))
            }
            None => (None, None),
        };
        samples.push(SurfaceSample {
            position,
            normal,
            uv,
            color,
            barycentric,
            triangle_index: selected.source_index,
            primitive_index: triangle.primitive_index,
            material_index: triangle.material_index,
            motion_position,
            size,
        });
    }
    Ok(SurfaceSampleResponse { samples })
}

fn check_json_bytes(bytes: usize) -> Result<(), SurfaceError> {
    if bytes > MAX_SURFACE_JSON_BYTES {
        return Err(SurfaceError::new(
            SurfaceErrorCode::InputBytes,
            "surface",
            "Surface JSON exceeds 64 MiB",
        ));
    }
    Ok(())
}

// This numeric-only schema needs only short field names and numeric tokens.
// Bound raw lexemes before Serde can allocate scratch space or error messages
// for adversarial escaped keys, strings, and unusually long decimal numbers.
fn check_json_tokens(input: &str) -> Result<(), SurfaceError> {
    let mut quoted = false;
    let mut escaped = false;
    let mut token_bytes = 0;
    for byte in input.bytes() {
        if quoted {
            token_bytes += 1;
            if escaped {
                escaped = false;
            } else if byte == b'\\' {
                escaped = true;
            } else if byte == b'"' {
                quoted = false;
                token_bytes = 0;
            }
        } else {
            match byte {
                b'"' => {
                    quoted = true;
                    token_bytes = 0;
                }
                b'{' | b'}' | b'[' | b']' | b',' | b':' | b' ' | b'\t' | b'\r' | b'\n' => {
                    token_bytes = 0
                }
                _ => token_bytes += 1,
            }
        }
        if token_bytes > MAX_SURFACE_JSON_TOKEN_BYTES {
            return Err(SurfaceError::new(
                SurfaceErrorCode::InvalidJson,
                "surface",
                "Surface JSON tokens may not exceed 256 bytes",
            ));
        }
    }
    Ok(())
}

fn check_budget(
    triangles: usize,
    capacity: usize,
    count: u32,
    input_bytes: usize,
) -> Result<(), SurfaceError> {
    check_budget_with_motion(triangles, capacity, count, input_bytes, false)
}

fn check_budget_with_motion(
    triangles: usize,
    capacity: usize,
    count: u32,
    input_bytes: usize,
    motion: bool,
) -> Result<(), SurfaceError> {
    check_json_bytes(input_bytes)?;
    if !(1..=MAX_SURFACE_TRIANGLES).contains(&triangles) {
        return Err(SurfaceError::new(
            SurfaceErrorCode::TriangleCount,
            "triangles",
            "Expected 1..262144 triangles",
        ));
    }
    if !(1..=MAX_SURFACE_SAMPLES).contains(&count) {
        return Err(SurfaceError::new(
            SurfaceErrorCode::SampleCount,
            "count",
            "Expected 1..65536 samples",
        ));
    }
    let required = capacity
        .checked_mul(size_of::<SurfaceTriangle>())
        .and_then(|bytes| {
            triangles
                .checked_mul(size_of::<PreparedTriangle>())
                .and_then(|extra| bytes.checked_add(extra))
        })
        .and_then(|bytes| {
            (count as usize)
                .checked_mul(size_of::<SurfaceSample>())
                .and_then(|extra| bytes.checked_add(extra))
        })
        .and_then(|bytes| bytes.checked_add(input_bytes))
        .and_then(|bytes| {
            bytes.checked_add(if motion {
                motion::MOTION_FIXED_WORKING_BYTES
            } else {
                0
            })
        })
        .and_then(|bytes| bytes.checked_add(SURFACE_FIXED_OVERHEAD_BYTES));
    if required.is_none_or(|bytes| bytes > MAX_SURFACE_WORKING_BYTES) {
        return Err(SurfaceError::new(
            SurfaceErrorCode::WorkingBytes,
            "surface",
            "Surface input, weights and samples exceed the 192 MiB working-set budget",
        ));
    }
    Ok(())
}

fn validate_triangle(triangle: &SurfaceTriangle, index: usize) -> Result<(), SurfaceError> {
    validate_finite(&triangle.position, index, "position")?;
    if let Some(normals) = &triangle.normal {
        validate_finite(normals, index, "normal")?;
        for (vertex, normal) in normals.iter().enumerate() {
            if *normal == [0.0; 3] {
                return Err(SurfaceError::new(
                    SurfaceErrorCode::ZeroNormal,
                    format!("triangles[{index}].normal[{vertex}]"),
                    "Vertex normal must be nonzero",
                ));
            }
        }
    }
    if let Some(uv) = &triangle.uv {
        validate_finite(uv, index, "uv")?;
    }
    if let Some(colors) = &triangle.color {
        validate_finite(colors, index, "color")?;
        for (vertex, color) in colors.iter().enumerate() {
            for (channel, value) in color.iter().enumerate() {
                if !(0.0..=1.0).contains(value) {
                    return Err(SurfaceError::new(
                        SurfaceErrorCode::ColorRange,
                        format!("triangles[{index}].color[{vertex}][{channel}]"),
                        "Linear RGBA channels must lie in [0, 1]",
                    ));
                }
            }
        }
    }
    Ok(())
}

fn validate_finite<const N: usize>(
    values: &[[f64; N]; 3],
    triangle: usize,
    name: &str,
) -> Result<(), SurfaceError> {
    for (vertex, values) in values.iter().enumerate() {
        for (component, value) in values.iter().enumerate() {
            if !value.is_finite() {
                return Err(SurfaceError::new(
                    SurfaceErrorCode::NonFinite,
                    format!("triangles[{triangle}].{name}[{vertex}][{component}]"),
                    "Surface attributes must be finite",
                ));
            }
        }
    }
    Ok(())
}

fn deserialize_triangles<'de, D>(deserializer: D) -> Result<Vec<SurfaceTriangle>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    struct TrianglesVisitor;
    impl<'de> serde::de::Visitor<'de> for TrianglesVisitor {
        type Value = Vec<SurfaceTriangle>;
        fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            formatter.write_str("an array of at most 262144 triangles")
        }
        fn visit_seq<A>(self, mut sequence: A) -> Result<Self::Value, A::Error>
        where
            A: serde::de::SeqAccess<'de>,
        {
            use serde::de::Error;
            if sequence
                .size_hint()
                .is_some_and(|size| size > MAX_SURFACE_TRIANGLES)
            {
                return Err(A::Error::custom("Triangle count exceeds 262144"));
            }
            let mut triangles = Vec::new();
            while let Some(triangle) = sequence.next_element::<SurfaceTriangle>()? {
                if triangles.len() == MAX_SURFACE_TRIANGLES {
                    return Err(A::Error::custom("Triangle count exceeds 262144"));
                }
                if triangles.len() == triangles.capacity() {
                    let next = (triangles.capacity().max(4) * 2).min(MAX_SURFACE_TRIANGLES);
                    // A growing allocation can briefly coexist with the old
                    // buffer. Include that peak and the maximum raw JSON size.
                    let growth_peak = (triangles.capacity() + next)
                        .checked_mul(size_of::<SurfaceTriangle>())
                        .and_then(|bytes| bytes.checked_add(MAX_SURFACE_JSON_BYTES))
                        .and_then(|bytes| bytes.checked_add(SURFACE_FIXED_OVERHEAD_BYTES));
                    if growth_peak.is_none_or(|bytes| bytes > MAX_SURFACE_WORKING_BYTES) {
                        return Err(A::Error::custom(
                            "Surface input growth exceeds the 192 MiB working-set budget",
                        ));
                    }
                    triangles
                        .try_reserve_exact(next - triangles.len())
                        .map_err(|_| A::Error::custom("Unable to allocate surface input"))?;
                }
                triangles.push(triangle);
            }
            Ok(triangles)
        }
    }
    deserializer.deserialize_seq(TrianglesVisitor)
}

struct SplitMix64(u64);
impl SplitMix64 {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut word = self.0;
        word = (word ^ (word >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        word = (word ^ (word >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        word ^ (word >> 31)
    }
    fn unit(&mut self) -> f64 {
        ((self.next() >> 11) as f64) * (1.0 / 9_007_199_254_740_992.0)
    }
}

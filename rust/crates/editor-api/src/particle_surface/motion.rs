//! Stateless, seekable motion applied after the unchanged surface sampler.
//! Time is an integer sourceTime from the Host's Rust frame mapping (120 kHz).
//! Scatter uses smoothstep out/hold/back. Idle drift remains active at all times;
//! with zero drift, the start and returned endpoints equal the base position.

use super::{SplitMix64, SurfaceError, SurfaceErrorCode, numeric};
use serde::{Deserialize, Serialize};

pub(super) const TICKS_PER_SECOND: f64 = 120_000.0;
pub(super) const MAX_TIME_TICKS: u64 = 9_007_199_254_740_991;
// Request/prepared state, PRNG, direction/phase scratch and numeric temporaries.
// No motion-specific Vec or allocation proportional to the sample count exists.
pub(super) const MOTION_FIXED_WORKING_BYTES: usize = 4096;
const MOTION_STREAM_DOMAIN: u64 = 0x6d6f_7469_6f6e_7631;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SurfaceMotion {
    pub version: u8,
    pub time_ticks: u64,
    pub scatter_start_ticks: u64,
    pub scatter_duration_ticks: u64,
    pub hold_duration_ticks: u64,
    pub return_duration_ticks: u64,
    pub scatter_distance: f64,
    pub drift_amplitude: f64,
    /// Cycles per second, not radians per tick.
    pub drift_frequency: f64,
    pub size: f64,
    /// Normalized variation: size factor is in [1-v/2, 1+v/2), hence >= 0.5.
    pub size_variance: f64,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "super::control::deserialize_optional"
    )]
    pub control: Option<super::control::SurfaceControl>,
}

pub(super) fn deserialize_optional<'de, D>(
    deserializer: D,
) -> Result<Option<SurfaceMotion>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    // Missing is the legacy request; explicit null must not silently disable it.
    SurfaceMotion::deserialize(deserializer).map(Some)
}

pub(super) struct PreparedMotion<'a> {
    source: &'a SurfaceMotion,
    scatter_weight: f64,
    drift_cycles: f64,
    control: Option<super::control::PreparedControl<'a>>,
}

fn bounded(value: f64, maximum: f64, positive: bool, field: &str) -> Result<(), SurfaceError> {
    if !value.is_finite() {
        return Err(SurfaceError::new(
            SurfaceErrorCode::NonFinite,
            format!("motion.{field}"),
            "Motion parameters must be finite",
        ));
    }
    if value < 0.0 || value > maximum || (positive && value == 0.0) {
        return Err(SurfaceError::numeric(
            format!("motion.{field}"),
            "Motion parameter is outside its supported range",
        ));
    }
    Ok(())
}

fn endpoint(start: u64, duration: u64, field: &str) -> Result<u64, SurfaceError> {
    start
        .checked_add(duration)
        .filter(|end| *end <= MAX_TIME_TICKS)
        .ok_or_else(|| {
            SurfaceError::numeric(
                format!("motion.{field}"),
                "Motion endpoint exceeds the exact JavaScript integer range",
            )
        })
}

fn smoothstep(value: f64) -> f64 {
    value * value * (3.0 - 2.0 * value)
}

impl<'a> PreparedMotion<'a> {
    pub(super) fn new(source: &'a SurfaceMotion, count: u32) -> Result<Self, SurfaceError> {
        if source.version != 1 {
            return Err(SurfaceError::numeric(
                "motion.version",
                "Unsupported motion version",
            ));
        }
        for (field, value, positive) in [
            ("timeTicks", source.time_ticks, false),
            ("scatterStartTicks", source.scatter_start_ticks, false),
            ("scatterDurationTicks", source.scatter_duration_ticks, true),
            ("holdDurationTicks", source.hold_duration_ticks, false),
            ("returnDurationTicks", source.return_duration_ticks, true),
        ] {
            if value > MAX_TIME_TICKS || (positive && value == 0) {
                return Err(SurfaceError::numeric(
                    format!("motion.{field}"),
                    "Motion ticks must be exact JavaScript integers with positive scatter/return durations",
                ));
            }
        }
        bounded(
            source.scatter_distance,
            1_000_000.0,
            false,
            "scatterDistance",
        )?;
        bounded(source.drift_amplitude, 1_000_000.0, false, "driftAmplitude")?;
        bounded(source.drift_frequency, 100.0, false, "driftFrequency")?;
        bounded(source.size, 1_000_000.0, true, "size")?;
        bounded(source.size_variance, 1.0, false, "sizeVariance")?;
        let scatter_end = endpoint(
            source.scatter_start_ticks,
            source.scatter_duration_ticks,
            "scatterDurationTicks",
        )?;
        let hold_end = endpoint(scatter_end, source.hold_duration_ticks, "holdDurationTicks")?;
        let return_end = endpoint(
            hold_end,
            source.return_duration_ticks,
            "returnDurationTicks",
        )?;
        // Subtract integer endpoints before conversion, retaining single-tick
        // ordering near the safe-integer maximum without a rounded wall clock.
        let time = source.time_ticks;
        let scatter_weight = if time <= source.scatter_start_ticks || time >= return_end {
            0.0
        } else if time < scatter_end {
            smoothstep(
                (time - source.scatter_start_ticks) as f64 / source.scatter_duration_ticks as f64,
            )
        } else if time <= hold_end {
            1.0
        } else {
            1.0 - smoothstep((time - hold_end) as f64 / source.return_duration_ticks as f64)
        };
        // Reduce phase before sin: the bounded tick/frequency product is finite,
        // and trigonometry never receives an unbounded argument.
        let drift_cycles = ((time as f64 / TICKS_PER_SECOND) * source.drift_frequency).fract();
        Ok(Self {
            source,
            scatter_weight,
            drift_cycles,
            control: source
                .control
                .as_ref()
                .map(|value| super::control::PreparedControl::new(value, time, count))
                .transpose()?,
        })
    }

    pub(super) fn apply(
        &self,
        position: [f64; 3],
        seed: u32,
        index: u32,
    ) -> Result<([f64; 3], f64), SurfaceError> {
        // Per-index domain separation preserves both the surface PRNG stream
        // and the prefix of every count. Time never enters the random stream.
        let mut random = SplitMix64(
            u64::from(seed)
                ^ MOTION_STREAM_DOMAIN
                ^ u64::from(index).wrapping_mul(0x9e37_79b9_7f4a_7c15),
        );
        let raw_direction = [
            random.unit() * 2.0 - 1.0,
            random.unit() * 2.0 - 1.0,
            random.unit() * 2.0 - 1.0,
        ];
        let direction = numeric::unit_vector(raw_direction).unwrap_or([1.0, 0.0, 0.0]);
        let distance = self.source.scatter_distance * random.unit();
        let phases = [random.unit(), random.unit(), random.unit()];
        let factor =
            1.0 - self.source.size_variance * 0.5 + self.source.size_variance * random.unit();
        let size = self.source.size * factor;
        if !size.is_finite() || size <= 0.0 {
            return Err(SurfaceError::numeric(
                format!("samples[{index}].size"),
                "Motion size cannot be represented as a positive finite f64",
            ));
        }
        let mut moved = position;
        for axis in 0..3 {
            let scatter = self.scatter_weight * distance * direction[axis];
            let drift = (self.source.drift_amplitude / 3.0_f64.sqrt())
                * (std::f64::consts::TAU * (self.drift_cycles + phases[axis])).sin();
            // Preserve exact endpoint bits, including signed zero, when idle
            // drift is disabled and the scatter envelope is at rest.
            if scatter != 0.0 || drift != 0.0 {
                moved[axis] = position[axis] + scatter + drift;
            }
            if !moved[axis].is_finite() {
                return Err(SurfaceError::numeric(
                    format!("samples[{index}].motionPosition[{axis}]"),
                    "Motion position exceeded the finite numeric range",
                ));
            }
        }
        if let Some(control) = &self.control {
            let offset = control.offset(position)?;
            for axis in 0..3 {
                if offset[axis] != 0.0 {
                    moved[axis] += offset[axis];
                }
                if !moved[axis].is_finite() {
                    return Err(SurfaceError::numeric(
                        format!("samples[{index}].motionPosition[{axis}]"),
                        "Control motion position exceeded finite range",
                    ));
                }
            }
        }
        Ok((moved, size))
    }
}

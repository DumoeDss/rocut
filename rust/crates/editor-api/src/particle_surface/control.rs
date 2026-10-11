//! Archived source-tick controls. Replay is independent of call order and PRNG.
//! The finite window includes its final-quarter contribution fade, not an
//! unbounded physical settle. At start/end and outside the window the control
//! contributes exactly zero to the existing scatter/drift baseline. The final
//! knot is the linear-trajectory endpoint, not an extra integrated output frame.
//! Work admission always covers the full schedule, including out-of-window and
//! zero-strength seeks. No PRNG, clock, author callback or persistent state.
use super::{SurfaceError, SurfaceErrorCode, motion::MAX_TIME_TICKS, numeric};
use serde::{Deserialize, Serialize};

pub(super) const MAX_KNOTS: usize = 128;
const STEP_TICKS: u64 = 1000;
const MAX_STEPS: u64 = 12_000;
const MAX_WORK: u64 = 2_000_000;

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ControlMode {
    Spring,
    Vortex,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ControlKnot {
    pub time_ticks: u64,
    pub position: [f64; 3],
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SurfaceControl {
    pub mode: ControlMode,
    pub start_ticks: u64,
    pub duration_ticks: u64,
    #[serde(deserialize_with = "deserialize_knots")]
    pub knots: Vec<ControlKnot>,
    pub restoring_force: f64,
    pub damping: f64,
    pub radius: f64,
    pub strength: f64,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_axis"
    )]
    pub axis: Option<[f64; 3]>,
}

pub(super) fn deserialize_optional<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Option<SurfaceControl>, D::Error> {
    SurfaceControl::deserialize(d).map(Some)
}
fn deserialize_axis<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<[f64; 3]>, D::Error> {
    <[f64; 3]>::deserialize(d).map(Some)
}
fn deserialize_knots<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Vec<ControlKnot>, D::Error> {
    use serde::de::{Error, SeqAccess, Visitor};
    struct Knots;
    impl<'de> Visitor<'de> for Knots {
        type Value = Vec<ControlKnot>;
        fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
            f.write_str("2..128 control knots")
        }
        fn visit_seq<A: SeqAccess<'de>>(self, mut sequence: A) -> Result<Self::Value, A::Error> {
            let mut knots = Vec::new();
            while let Some(knot) = sequence.next_element::<ControlKnot>()? {
                if knots.len() == MAX_KNOTS {
                    return Err(A::Error::custom("Control knot budget exceeds 128"));
                }
                knots
                    .try_reserve_exact(1)
                    .map_err(|_| A::Error::custom("Unable to allocate control knots"))?;
                knots.push(knot);
            }
            Ok(knots)
        }
    }
    d.deserialize_seq(Knots)
}

fn error(field: &str, message: &str) -> SurfaceError {
    SurfaceError::numeric(format!("motion.control.{field}"), message)
}
fn bounded(value: f64, max: f64, positive: bool, field: &str) -> Result<(), SurfaceError> {
    if !value.is_finite() {
        return Err(SurfaceError::new(
            SurfaceErrorCode::NonFinite,
            format!("motion.control.{field}"),
            "Control values must be finite",
        ));
    }
    if value < 0.0 || value > max || (positive && value == 0.0) {
        return Err(error(field, "Control value is outside its supported range"));
    }
    Ok(())
}

pub(super) struct PreparedControl<'a> {
    source: &'a SurfaceControl,
    axis: [f64; 3],
    elapsed: u64,
    weight: f64,
}
impl<'a> PreparedControl<'a> {
    pub(super) fn new(
        source: &'a SurfaceControl,
        time: u64,
        count: u32,
    ) -> Result<Self, SurfaceError> {
        if source.start_ticks > MAX_TIME_TICKS
            || source.duration_ticks == 0
            || source.duration_ticks > STEP_TICKS * MAX_STEPS
        {
            return Err(error(
                "durationTicks",
                "Control requires exact ticks and duration 1..12000000",
            ));
        }
        let end = source
            .start_ticks
            .checked_add(source.duration_ticks)
            .filter(|v| *v <= MAX_TIME_TICKS)
            .ok_or_else(|| {
                error(
                    "durationTicks",
                    "Control endpoint exceeds exact JavaScript ticks",
                )
            })?;
        let steps = source.duration_ticks.div_ceil(STEP_TICKS);
        if u64::from(count) * steps > MAX_WORK {
            return Err(error(
                "durationTicks",
                "Control full-window particle-step work exceeds 2000000",
            ));
        }
        bounded(source.restoring_force, 1000.0, false, "restoringForce")?;
        bounded(source.damping, 100.0, false, "damping")?;
        bounded(source.strength, 1000.0, false, "strength")?;
        bounded(source.radius, 1_000_000.0, true, "radius")?;
        if !(2..=MAX_KNOTS).contains(&source.knots.len()) {
            return Err(error("knots", "Expected 2..128 control knots"));
        }
        let mut previous = None;
        for (i, knot) in source.knots.iter().enumerate() {
            if knot.time_ticks < source.start_ticks
                || knot.time_ticks > end
                || previous.is_some_and(|v| knot.time_ticks <= v)
            {
                return Err(error(
                    &format!("knots[{i}].timeTicks"),
                    "Control knots must increase strictly within the control window",
                ));
            }
            previous = Some(knot.time_ticks);
            for (axis, value) in knot.position.iter().enumerate() {
                if !value.is_finite() {
                    return Err(SurfaceError::new(
                        SurfaceErrorCode::NonFinite,
                        format!("motion.control.knots[{i}].position[{axis}]"),
                        "Control position must be finite",
                    ));
                }
                if value.abs() > 1_000_000.0 {
                    return Err(error(
                        &format!("knots[{i}].position[{axis}]"),
                        "Control position exceeds supported range",
                    ));
                }
            }
        }
        if source.knots[0].time_ticks != source.start_ticks
            || source.knots.last().unwrap().time_ticks != end
        {
            return Err(error(
                "knots",
                "First/last knots must equal the control start/end ticks",
            ));
        }
        let axis = match (source.mode, source.axis) {
            (ControlMode::Spring, None) => [0.0; 3],
            (ControlMode::Vortex, Some(axis)) if axis.iter().all(|v| v.is_finite()) => {
                numeric::unit_vector(axis)
                    .ok_or_else(|| error("axis", "Vortex axis must be nonzero"))?
            }
            _ => {
                return Err(error(
                    "axis",
                    "Vortex requires finite nonzero axis; spring forbids axis",
                ));
            }
        };
        let elapsed = if time > source.start_ticks && time < end {
            time - source.start_ticks
        } else {
            0
        };
        let progress = elapsed as f64 / source.duration_ticks as f64;
        let fade = ((progress - 0.75) * 4.0).clamp(0.0, 1.0);
        let weight = 1.0 - fade * fade * (3.0 - 2.0 * fade);
        Ok(Self {
            source,
            axis,
            elapsed,
            weight,
        })
    }

    pub(super) fn center(&self, tick: u64) -> [f64; 3] {
        let knots = &self.source.knots;
        let right = knots
            .partition_point(|k| k.time_ticks <= tick)
            .min(knots.len() - 1);
        let left = right.saturating_sub(1);
        let a = knots[left];
        let b = knots[right];
        let weight = (tick - a.time_ticks) as f64 / (b.time_ticks - a.time_ticks) as f64;
        std::array::from_fn(|i| a.position[i] + (b.position[i] - a.position[i]) * weight)
    }

    pub(super) fn offset(&self, base: [f64; 3]) -> Result<[f64; 3], SurfaceError> {
        if self.elapsed == 0 || self.source.strength == 0.0 {
            return Ok([0.0; 3]);
        }
        let mut offset = [0.0; 3];
        let mut velocity = [0.0; 3];
        let mut tick = 0;
        while tick < self.elapsed {
            let step = STEP_TICKS.min(self.elapsed - tick);
            // Left-end force sampling on an absolute fixed tick grid; final
            // fractional step makes even one-tick seeks well-defined.
            let center = self.center(self.source.start_ticks + tick);
            let delta: [f64; 3] = std::array::from_fn(|i| (center[i] - base[i]) - offset[i]);
            let distance = delta[0].hypot(delta[1]).hypot(delta[2]);
            if !distance.is_finite() {
                return Err(error("position", "Control distance exceeded finite range"));
            }
            let falloff = (1.0 - distance / self.source.radius).max(0.0);
            let direction = match self.source.mode {
                ControlMode::Spring => delta,
                ControlMode::Vortex => [
                    self.axis[1] * delta[2] - self.axis[2] * delta[1],
                    self.axis[2] * delta[0] - self.axis[0] * delta[2],
                    self.axis[0] * delta[1] - self.axis[1] * delta[0],
                ],
            };
            let dt = step as f64 / super::motion::TICKS_PER_SECOND;
            for i in 0..3 {
                let external = if falloff == 0.0 {
                    0.0
                } else {
                    self.source.strength * direction[i] * falloff
                };
                velocity[i] += (external
                    - self.source.restoring_force * offset[i]
                    - self.source.damping * velocity[i])
                    * dt;
            }
            clamp(&mut velocity, self.source.radius * 120.0)?;
            for i in 0..3 {
                offset[i] += velocity[i] * dt;
            }
            clamp(&mut offset, self.source.radius)?;
            tick += step;
        }
        Ok(offset.map(|value| value * self.weight))
    }
}

fn clamp(value: &mut [f64; 3], limit: f64) -> Result<(), SurfaceError> {
    let length = value[0].hypot(value[1]).hypot(value[2]);
    if !length.is_finite() {
        return Err(error("position", "Control dynamics exceeded finite range"));
    }
    if length > limit {
        for axis in value {
            *axis = (*axis / length) * limit;
        }
    }
    Ok(())
}

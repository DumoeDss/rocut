//! AudioParam event playback is distinct from track envelope evaluation. Native
//! Float32 event values and value-curve samples are retained through this stage.
//! Chrome 151 native PCM oracle: 36 cases / 530496 stereo values, max absolute
//! gain difference 1.073e-6. Scalar interpolation is not bit-identical to Chrome's
//! vectorized AudioParam arithmetic; the verified gain tolerance is 2e-6.
use super::bus_schedule::{BusSchedule, Event};

struct Cursor<'a> {
    schedule: &'a BusSchedule,
    index: usize,
    value: f32,
    previous_time: f64,
}

impl<'a> Cursor<'a> {
    fn new(schedule: &'a BusSchedule) -> Self {
        Self {
            schedule,
            index: 0,
            value: schedule.static_gain as f32,
            previous_time: 0.0,
        }
    }

    fn gain(&mut self, time: f64) -> f32 {
        while let Some(event) = self.schedule.events.get(self.index) {
            match event {
                Event::Set { time: at, value } => {
                    if time < *at {
                        return self.value;
                    }
                    self.value = *value as f32;
                    self.previous_time = *at;
                }
                Event::Ramp { time: end, value } => {
                    let target = *value as f32;
                    if time < *end {
                        let x = ((time - self.previous_time) / (end - self.previous_time))
                            .clamp(0.0, 1.0);
                        return (f64::from(self.value)
                            + (f64::from(target) - f64::from(self.value)) * x)
                            as f32;
                    }
                    self.value = target;
                    self.previous_time = *end;
                }
                Event::Curve {
                    time: start,
                    duration,
                    values,
                } => {
                    if time < *start {
                        return self.value;
                    }
                    if time < start + duration {
                        let position = ((time - start) / duration * (values.len() - 1) as f64)
                            .clamp(0.0, (values.len() - 1) as f64);
                        let left = position.floor() as usize;
                        let a = f64::from(values[left]);
                        let b = f64::from(values[(left + 1).min(values.len() - 1)]);
                        return (a + (b - a) * (position - left as f64)) as f32;
                    }
                    self.value = *values.last().unwrap_or(&self.value);
                    self.previous_time = start + duration;
                }
            }
            self.index += 1;
        }
        self.value
    }
}

pub(super) fn add(
    output: &mut [f32],
    bytes: &[u8],
    schedule: &BusSchedule,
    sample_rate: u32,
) -> Result<(), String> {
    let mut cursor = Cursor::new(schedule);
    for (frame, target) in output.chunks_exact_mut(2).enumerate() {
        let gain = cursor.gain(frame as f64 / f64::from(sample_rate));
        for channel in 0..2 {
            let offset = (frame * 2 + channel) * 4;
            let value = f32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap());
            target[channel] += value * gain;
            if !target[channel].is_finite() {
                return Err("Non-finite HyperFrames post-bus-fader PCM".into());
            }
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "bus_pcm_tests.rs"]
mod tests;

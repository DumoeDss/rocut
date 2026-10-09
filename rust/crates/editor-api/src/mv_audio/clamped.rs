use super::{Channel, Data};

impl Data {
    /// Reference `makeEnv` interpolation over validated, measured channel facts.
    /// Unlike `Signal`, this clamps outside the sampled time range and does not
    /// quantize source seconds to ticks. Missing facts are never invented.
    pub fn sample_envelope_clamped(
        &self,
        channel: Channel,
        source_seconds: f64,
    ) -> Result<f64, String> {
        if !source_seconds.is_finite() {
            return Err("Clamped envelope sampling requires finite source seconds".into());
        }
        let values = self
            .channels
            .get(&channel)
            .filter(|values| !values.is_empty())
            .ok_or("Requested measured envelope channel is unavailable")?;
        if source_seconds <= 0.0 {
            return Ok(values[0]);
        }
        let last = values.len() - 1;
        if source_seconds >= last as f64 / f64::from(self.fps) {
            return Ok(values[last]);
        }
        let x = source_seconds * f64::from(self.fps);
        let index = x.floor() as usize;
        let first = values[index.min(last)];
        let next = values[(index + 1).min(last)];
        Ok(first + (next - first) * (x - index as f64))
    }
}

#[cfg(test)]
#[path = "clamped_tests.rs"]
mod tests;

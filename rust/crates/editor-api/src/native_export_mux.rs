use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Rate {
    pub numerator: u64,
    pub denominator: u64,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Segment {
    pub native_job_id: String,
    pub output_sha256: String,
    pub scope_digest: String,
    pub start_frame: u64,
    pub frame_count: u64,
    pub sample_count: u64,
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> Mux {
        let samples = |frame: u64| (frame * 48000 * 1001) / 30000;
        Mux {
            version: 1,
            frame_rate: Rate {
                numerator: 30000,
                denominator: 1001,
            },
            sample_rate: 48000,
            segments: vec![
                Segment {
                    native_job_id: "1".repeat(36),
                    output_sha256: "a".repeat(64),
                    scope_digest: "b".repeat(64),
                    start_frame: 7,
                    frame_count: 59,
                    sample_count: samples(66) - samples(7),
                },
                Segment {
                    native_job_id: "2".repeat(36),
                    output_sha256: "c".repeat(64),
                    scope_digest: "d".repeat(64),
                    start_frame: 66,
                    frame_count: 59,
                    sample_count: samples(125) - samples(66),
                },
            ],
        }
    }
    #[test]
    fn contiguous_fractional_frames_and_cumulative_samples() {
        let mux = fixture();
        assert!(mux.validate(Some((7 * 4004, 125 * 4004))).is_ok());
        let mut bad = mux.clone();
        bad.segments[1].start_frame += 1;
        assert!(bad.validate(Some((7 * 4004, 125 * 4004))).is_err());
        let mut bad = mux.clone();
        bad.segments[1].sample_count += 1;
        assert!(bad.validate(Some((7 * 4004, 125 * 4004))).is_err());
        let mut bad = mux.clone();
        bad.segments[1].native_job_id = bad.segments[0].native_job_id.clone();
        assert!(bad.validate(Some((7 * 4004, 125 * 4004))).is_err());
        assert!(mux.validate(Some((0, 125 * 4004))).is_err());
    }
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Mux {
    pub version: u8,
    pub frame_rate: Rate,
    pub sample_rate: u32,
    pub segments: Vec<Segment>,
}
impl Mux {
    pub fn validate(&self, range: Option<(u64, u64)>) -> Result<(), String> {
        let rate = &self.frame_rate;
        if self.version != 1
            || self.sample_rate != 48000
            || rate.numerator == 0
            || rate.numerator > 120000
            || rate.denominator == 0
            || rate.denominator > 1001
            || 120000 * rate.denominator % rate.numerator != 0
            || self.segments.is_empty()
            || self.segments.len() > 1000
        {
            return Err("Invalid native segment mux clock or size".into());
        }
        let grid = 120000 * rate.denominator / rate.numerator;
        let digest = |v: &str, len: usize| {
            v.len() == len
                && v.bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        };
        let samples = |frame: u64| {
            (u128::from(frame) * 48000 * u128::from(rate.denominator)) / u128::from(rate.numerator)
        };
        let mut next = self.segments[0].start_frame;
        let mut ids = std::collections::BTreeSet::new();
        for item in &self.segments {
            let end = item
                .start_frame
                .checked_add(item.frame_count)
                .ok_or("Mux frame overflow")?;
            if item.start_frame != next
                || item.frame_count == 0
                || end > 9_007_199_254_740_991 / grid
                || !digest(&item.native_job_id, 36)
                || !digest(&item.output_sha256, 64)
                || !digest(&item.scope_digest, 64)
                || !ids.insert(&item.native_job_id)
                || samples(end) - samples(item.start_frame) != u128::from(item.sample_count)
            {
                return Err("Native mux segments require contiguous frames, cumulative exact samples and fixed output identities".into());
            }
            next = end;
        }
        if range != Some((self.segments[0].start_frame * grid, next * grid)) {
            return Err("Native mux range differs from its exact frame coverage".into());
        }
        Ok(())
    }
}

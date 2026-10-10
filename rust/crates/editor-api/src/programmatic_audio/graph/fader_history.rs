//! Complete native gain-write history. Event levels already include the native
//! fade; replay holds each actual write until the next one, never interpolates
//! observations or applies gain/fades twice. Host owns the single canonical
//! native realm and supplies every write, including the initial one.
use super::super::{
    fader::observed_envelope,
    fader_model::{GainSource, ResolvedAuthorGain},
    snapshot::Track,
};
use crate::programmatic_audio::envelope::GainEnvelope;
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(in crate::programmatic_audio::graph) struct NativeFallbackHistory {
    pub profile: String,
    pub instance_id: String,
    pub resource_id: String,
    pub canonical_start: f64,
    pub canonical_end: f64,
    pub events: Vec<NativeGainWrite>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(in crate::programmatic_audio::graph) struct NativeGainWrite {
    pub sequence: u32,
    pub applied_author_gain: f64,
    pub effective_element_volume: f64,
    pub gain: ResolvedAuthorGain,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::programmatic_audio::graph) struct NativeGainHistory {
    pub profile: &'static str,
    pub start: f64,
    pub events: Vec<ResolvedWrite>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::programmatic_audio::graph) struct ResolvedWrite {
    pub time: f64,
    pub gain: f64,
}

impl NativeGainHistory {
    pub fn evaluate(&self, local_time: f64) -> f64 {
        let time = self.start + local_time;
        let count = self.events.partition_point(|event| event.time <= time);
        self.events[count.saturating_sub(1)].gain
    }
}

pub(in crate::programmatic_audio::graph) fn resolve(
    track: &Track,
    history: &NativeFallbackHistory,
    duration: f64,
) -> Result<NativeGainHistory, String> {
    if history.profile != "hyperframes-native-sync-all-author-writes-v1"
        || history.instance_id != track.instance_id
        || history.resource_id != track.resource_id
        || history.canonical_start != 0.0
        || history.canonical_end != duration
        || history.events.is_empty()
        || history.events.len() > 32768
    {
        return Err(
            "Invalid or incomplete HyperFrames native fallback history identity/coverage".into(),
        );
    }
    let mut previous_time = None;
    let mut previous_effective = None;
    let mut events = Vec::with_capacity(history.events.len());
    for (index, event) in history.events.iter().enumerate() {
        let ResolvedAuthorGain::Observed {
            observed_at,
            gain_before_fades,
            source: GainSource::Fallback,
            fallback: Some(fallback),
            ..
        } = &event.gain
        else {
            return Err(
                "Native fallback history must contain original fallback branch writes".into(),
            );
        };
        observed_envelope(track, &event.gain, false)?;
        if event.sequence as usize != index
            || *observed_at > duration
            || previous_time.is_some_and(|time| *observed_at < time)
            || (index == 0 && *observed_at > track.native.start)
            || previous_effective
                .is_some_and(|effective| fallback.previous_runtime_volume != Some(effective))
        {
            return Err(
                "HyperFrames native fallback history has missing, reordered or stale writes".into(),
            );
        }
        let envelope = GainEnvelope {
            version: 1,
            start: track.native.start,
            duration: track.native.duration,
            base_gain: *gain_before_fades,
            fade_in: track.native.fades.fade_in,
            fade_out: track.native.fades.fade_out,
            points: Vec::new(),
        };
        let expected = envelope.evaluate(*observed_at);
        if !event.applied_author_gain.is_finite()
            || (event.applied_author_gain - expected).abs() > 1e-7
            || !event.effective_element_volume.is_finite()
            || !(0.0..=1.0).contains(&event.effective_element_volume)
        {
            return Err(
                "HyperFrames native fallback write disagrees with original gain/fade policy".into(),
            );
        }
        events.push(ResolvedWrite {
            time: *observed_at,
            gain: event.applied_author_gain,
        });
        previous_time = Some(*observed_at);
        previous_effective = Some(event.effective_element_volume);
    }
    Ok(NativeGainHistory {
        profile: "hyperframes-native-sync-all-author-writes-v1",
        start: track.native.start,
        events,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn actual_writes_hold_last_duplicate_without_interpolation_or_refade() {
        let history = NativeGainHistory {
            profile: "hyperframes-native-sync-all-author-writes-v1",
            start: 1.0,
            events: vec![
                ResolvedWrite {
                    time: 1.0,
                    gain: 0.2,
                },
                ResolvedWrite {
                    time: 1.0,
                    gain: 0.4,
                },
                ResolvedWrite {
                    time: 1.5,
                    gain: 0.8,
                },
            ],
        };
        assert_eq!(history.evaluate(0.0), 0.4);
        assert_eq!(history.evaluate(0.25), 0.4);
        assert_eq!(history.evaluate(0.5), 0.8);
        assert_eq!(history.evaluate(3.0), 0.8);
    }
}

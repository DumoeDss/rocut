use super::range::{Rate, resolve_range};
use super::timing::{AudioTiming, deserialize_timing};
use crate::programmatic::Source;
use bridge::export;
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AudioSettings {
    version: u32,
    mode: String,
    #[serde(default, deserialize_with = "deserialize_profile")]
    profile: Option<AudioProfile>,
    #[serde(default, deserialize_with = "deserialize_timing")]
    timing: AudioTiming,
    #[serde(default)]
    pub muted: bool,
    #[serde(default)]
    pub volume_db: f64,
}

enum AudioProfile {
    HyperframesGraphV1,
}

fn deserialize_profile<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Option<AudioProfile>, D::Error> {
    // Omission selects legacy behavior; explicit null must not silently downgrade.
    match String::deserialize(d)?.as_str() {
        "hyperframes-graph-v1" => Ok(Some(AudioProfile::HyperframesGraphV1)),
        _ => Err(serde::de::Error::custom(
            "Unsupported programmatic audio profile",
        )),
    }
}

impl AudioSettings {
    pub fn profile(&self) -> Option<&'static str> {
        self.profile.as_ref().map(|profile| match profile {
            AudioProfile::HyperframesGraphV1 => "hyperframes-graph-v1",
        })
    }

    pub fn valid(&self) -> bool {
        self.version == 1
            && self.mode == "native"
            && (!self.timing.native_exporter() || self.profile.is_some())
            && self.volume_db.is_finite()
            && (-60.0..=20.0).contains(&self.volume_db)
    }
}

pub(crate) fn deserialize_audio<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Option<AudioSettings>, D::Error> {
    AudioSettings::deserialize(d).map(Some)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    source: Source,
    sample_rate: u32,
}

/// Shared source-cache/preview/export admission. This does not render audio.
#[export]
pub fn resolve_programmatic_audio_source_json(input: String) -> String {
    let result = (|| -> Result<serde_json::Value, String> {
        if input.len() > 2_000_000 {
            return Err("Programmatic audio source payload exceeds the limit".into());
        }
        let r: Request = serde_json::from_str(&input).map_err(|e| e.to_string())?;
        if let Some(issue) = r.source.validate().first() {
            return Err(issue.message.clone());
        }
        let Some((settings, numerator, denominator, duration_frames)) = r.source.native_audio()
        else {
            return Ok(serde_json::Value::Null);
        };
        let range = resolve_range(
            1,
            &Rate {
                numerator,
                denominator,
            },
            r.sample_rate,
            0,
            duration_frames,
        )?;
        let mut plan = serde_json::json!({"range":range,"muted":settings.muted,"gain":10f64.powf(settings.volume_db / 20.0)});
        // Keep the legacy response shape unchanged. Hosts route an explicit
        // graph request only from this Rust-admitted field, never by inference.
        if let Some(profile) = settings.profile() {
            plan["profile"] = serde_json::json!(profile);
        }
        if settings.timing.native_exporter() {
            plan["timing"] = serde_json::json!("native-exporter");
        }
        Ok(plan)
    })();
    match result {
        Ok(plan) => serde_json::json!({"plan":plan}).to_string(),
        Err(error) => serde_json::json!({"error":error}).to_string(),
    }
}

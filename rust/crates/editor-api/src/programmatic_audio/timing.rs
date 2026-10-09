//! Compatibility-additive final exporter timing. Omission is the existing
//! sample-aligned graph; explicit null/unknown values must never downgrade it.
use serde::Deserialize;

#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub(crate) enum AudioTiming {
    #[default]
    SampleAligned,
    NativeExporter,
}

pub(crate) fn deserialize_timing<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<AudioTiming, D::Error> {
    match String::deserialize(d)?.as_str() {
        "native-exporter" => Ok(AudioTiming::NativeExporter),
        _ => Err(serde::de::Error::custom(
            "Unsupported programmatic audio timing",
        )),
    }
}

impl AudioTiming {
    pub(crate) fn native_exporter(self) -> bool {
        self == Self::NativeExporter
    }
}

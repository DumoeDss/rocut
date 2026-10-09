use super::{Request, VideoChroma, vp9};
use serde::Deserialize;
use serde_json::{Value, json};

// The default applies only to an absent field. Explicit null, floating point,
// strings and tagged objects must never silently select the Canvas path.
pub(super) fn deserialize<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<u8>, D::Error> {
    let value = u8::deserialize(deserializer)?;
    if value > 63 {
        return Err(serde::de::Error::custom(
            "videoQuantizer must be an integer from 0 to 63",
        ));
    }
    Ok(Some(value))
}

pub(super) fn plan(request: &Request, quantizer: u8, bitrate: u32) -> Result<Value, &'static str> {
    let codec = vp9::quantizer_codec_string(
        request.width,
        request.height,
        request.frame_rate,
        bitrate,
        matches!(request.video_chroma, VideoChroma::Yuv444),
    )?;
    let key_frame_interval_frames = (2 * u64::from(request.frame_rate.numerator))
        .div_ceil(u64::from(request.frame_rate.denominator));
    Ok(json!({
        "kind":"vp9Quantizer", "bitrate":bitrate, "fullCodecString":codec,
        "quantizer":quantizer, "keyFrameIntervalFrames":key_frame_interval_frames,
        "nativeConfig":{
            "codec":codec,"width":request.width,"height":request.height,
            "displayWidth":request.width,"displayHeight":request.height,
            "framerate":request.frame_rate.as_f64().unwrap(),"bitrate":bitrate,
            "alpha":"discard","bitrateMode":"quantizer","latencyMode":"quality",
            "hardwareAcceleration":"prefer-software"
        }
    }))
}

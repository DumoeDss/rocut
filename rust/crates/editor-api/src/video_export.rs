use bridge::export;
use serde::Deserialize;
use serde_json::json;
use time::FrameRate;

mod quantizer;
mod vp9;

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum Quality {
    Low,
    Medium,
    High,
    VeryHigh,
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum Codec {
    Avc,
    Vp9,
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum Format {
    Mp4,
    Webm,
}

#[derive(Default)]
enum VideoChroma {
    #[default]
    Yuv420,
    Yuv444,
}

impl<'de> Deserialize<'de> for VideoChroma {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        // A string-only decoder also rejects externally tagged enum objects.
        match String::deserialize(deserializer)?.as_str() {
            "420" => Ok(Self::Yuv420),
            "444" => Ok(Self::Yuv444),
            _ => Err(serde::de::Error::custom("videoChroma must be 420 or 444")),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    width: u32,
    height: u32,
    frame_rate: FrameRate,
    quality: Quality,
    codec: Codec,
    #[serde(default)]
    video_chroma: VideoChroma,
    #[serde(default)]
    format: Option<Format>,
    #[serde(default, deserialize_with = "quantizer::deserialize")]
    video_quantizer: Option<u8>,
}

fn bitrate(request: &Request) -> Result<u32, &'static str> {
    if request.width == 0 || request.height == 0 {
        return Err("Export dimensions must be positive integers");
    }
    if request
        .frame_rate
        .ticks_per_frame()
        .is_none_or(|ticks| ticks <= 0)
    {
        return Err("Export frame rate must use an integral positive tick interval");
    }
    if matches!(request.video_chroma, VideoChroma::Yuv444) && !matches!(request.codec, Codec::Vp9) {
        return Err("4:4:4 export requires the VP9 codec");
    }
    let pixels = f64::from(request.width) * f64::from(request.height);
    let efficiency = match request.codec {
        Codec::Avc => 1.0,
        Codec::Vp9 => 0.6,
    };
    let factor = match request.quality {
        Quality::Low => 0.6,
        Quality::Medium => 1.0,
        Quality::High => 2.0,
        Quality::VeryHigh => 4.0,
    };
    // Preserve the existing presets' resolution curve. Very-high additionally
    // budgets detail per frame, so rapid motion is not starved at small sizes.
    let baseline = 3_000_000.0 * (pixels / (1920.0 * 1080.0)).powf(0.95) * efficiency * factor;
    let requested =
        if matches!(request.quality, Quality::VeryHigh) && matches!(request.codec, Codec::Vp9) {
            // VP9 very-high keeps the full 0.5 bits/pixel/frame detail budget for
            // both chroma modes; compression efficiency discounts only the baseline.
            // Round the rational budget before converting to avoid float boundaries.
            let samples = u128::from(request.width)
                * u128::from(request.height)
                * u128::from(request.frame_rate.numerator);
            let divisor = 2 * u128::from(request.frame_rate.denominator) * 1000;
            let detail_budget = samples.div_ceil(divisor) * 1000;
            if detail_budget > u128::from(u32::MAX) {
                return Err("Export bitrate exceeds the supported numeric range");
            }
            baseline.max(detail_budget as f64)
        } else if matches!(request.quality, Quality::VeryHigh) {
            baseline.max(pixels * request.frame_rate.as_f64().unwrap() * 0.5 * efficiency)
        } else {
            baseline
        };
    let rounded = (requested / 1000.0).ceil() * 1000.0;
    if !rounded.is_finite() || rounded > f64::from(u32::MAX) {
        return Err("Export bitrate exceeds the supported numeric range");
    }
    Ok(rounded as u32)
}

fn resolve(request: Request) -> Result<serde_json::Value, &'static str> {
    if let Some(quantizer) = request.video_quantizer {
        if !matches!(request.codec, Codec::Vp9) || !matches!(request.format, Some(Format::Webm)) {
            return Err("Explicit video quantizer requires VP9 and WebM format");
        }
        return quantizer::plan(&request, quantizer, bitrate(&request)?);
    }
    let bitrate = bitrate(&request)?;
    if matches!(request.video_chroma, VideoChroma::Yuv444) {
        let codec =
            vp9::full_codec_string(request.width, request.height, request.frame_rate, bitrate)?;
        Ok(json!({"bitrate":bitrate,"fullCodecString":codec}))
    } else {
        Ok(json!({"bitrate":bitrate}))
    }
}

#[export]
pub fn resolve_video_export_json(input: String) -> String {
    match serde_json::from_str::<Request>(&input) {
        Ok(request) => match resolve(request) {
            Ok(response) => response.to_string(),
            Err(error) => json!({"error":error}).to_string(),
        },
        Err(error) => json!({"error":format!("Invalid video export request: {error}")}).to_string(),
    }
}

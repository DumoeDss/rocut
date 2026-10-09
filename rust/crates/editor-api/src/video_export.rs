use bridge::export;
use serde::Deserialize;
use serde_json::json;
use time::FrameRate;

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
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    width: u32,
    height: u32,
    frame_rate: FrameRate,
    quality: Quality,
    codec: Codec,
}

fn bitrate(request: Request) -> Result<u32, &'static str> {
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
    let requested = if matches!(request.quality, Quality::VeryHigh) {
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

#[export]
pub fn resolve_video_export_json(input: String) -> String {
    match serde_json::from_str::<Request>(&input) {
        Ok(request) => match bitrate(request) {
            Ok(bitrate) => json!({"bitrate":bitrate}).to_string(),
            Err(error) => json!({"error":error}).to_string(),
        },
        Err(error) => json!({"error":format!("Invalid video export request: {error}")}).to_string(),
    }
}

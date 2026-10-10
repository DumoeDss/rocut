//! Pinned Remotion produced assets, not declared/static resources. Browser IO
//! copies registrations; admission and the original inline source clock live here.
use super::range::Rate;
use super::{MAX_ASSETS, MAX_BYTES, MAX_OBSERVATION_BYTES, MAX_SECONDS, MAX_TOTAL_BYTES};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::HashSet;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    version: u32,
    frame_index: u32,
    frame_rate: Rate,
    duration_frames: u32,
    assets: Vec<Asset>,
    #[serde(default)]
    declared_media_asset_count: usize,
    #[serde(default)]
    admitted_source_bytes: u64,
    #[serde(default)]
    declared_source_count: usize,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case", deny_unknown_fields)]
enum Asset {
    #[serde(rename_all = "camelCase")]
    InlineAudio {
        id: String,
        audio: Vec<f64>,
        frame: u32,
        timestamp: f64,
        duration: f64,
        tone_frequency: f64,
    },
    #[serde(rename_all = "camelCase")]
    Artifact {
        id: String,
        filename: String,
        frame: i64,
        download_behavior: Option<Download>,
        content_type: String,
        content: Option<String>,
    },
}
#[derive(Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "kebab-case", deny_unknown_fields)]
enum Download {
    PlayInBrowser,
    #[serde(rename_all = "camelCase")]
    Download {
        file_name: Option<String>,
    },
}

fn identity(id: &str) -> bool {
    !id.is_empty() && id.len() <= 256 && !id.chars().any(char::is_control)
}
fn logical_filename(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 1024
        && !name.starts_with('/')
        && name.split('/').all(|part| {
            !part.is_empty()
                && part != "."
                && part != ".."
                && !part.ends_with(['.', ' '])
                && !part
                    .chars()
                    .any(|c| c.is_control() || "\\:<>\"|?*".contains(c))
                && {
                    let stem = part.split('.').next().unwrap().to_ascii_uppercase();
                    !matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
                        && !(stem.len() == 4
                            && (stem.starts_with("COM") || stem.starts_with("LPT"))
                            && matches!(stem.as_bytes()[3], b'1'..=b'9'))
                }
        })
}

fn base64_bytes(encoded: &str) -> Result<Vec<u8>, String> {
    let bytes = encoded.as_bytes();
    if bytes.len() % 4 != 0 || bytes.len() as u64 > (MAX_BYTES + 2) / 3 * 4 {
        return Err("Invalid or oversized native artifact base64".into());
    }
    let digit = |value: u8| match value {
        b'A'..=b'Z' => Some(value - b'A'),
        b'a'..=b'z' => Some(value - b'a' + 26),
        b'0'..=b'9' => Some(value - b'0' + 52),
        b'+' => Some(62),
        b'/' => Some(63),
        _ => None,
    };
    let mut output = Vec::with_capacity(bytes.len() / 4 * 3);
    for (index, chunk) in bytes.chunks_exact(4).enumerate() {
        let a = digit(chunk[0]).ok_or("Invalid native artifact base64")?;
        let b = digit(chunk[1]).ok_or("Invalid native artifact base64")?;
        let last = index + 1 == bytes.len() / 4;
        let c = if chunk[2] == b'=' && last {
            0
        } else {
            digit(chunk[2]).ok_or("Invalid native artifact base64")?
        };
        let d = if chunk[3] == b'=' && last {
            0
        } else {
            digit(chunk[3]).ok_or("Invalid native artifact base64")?
        };
        if (chunk[2] == b'=' && (chunk[3] != b'=' || b & 15 != 0))
            || (chunk[3] == b'=' && chunk[2] != b'=' && c & 3 != 0)
        {
            return Err("Noncanonical native artifact base64".into());
        }
        output.push((a << 2) | (b >> 4));
        if chunk[2] != b'=' {
            output.push((b << 4) | (c >> 2));
        }
        if chunk[3] != b'=' {
            output.push((c << 6) | d);
        }
    }
    Ok(output)
}

fn native_sample_position(time: f64) -> u64 {
    let value = time * 48000.0;
    let rounded = value.round();
    if (value - rounded).abs() < 0.00001 {
        rounded as u64
    } else {
        value.floor() as u64
    }
}

fn admit(request: Request) -> Result<Value, String> {
    let rate = &request.frame_rate;
    if request.version != 1
        || request.assets.len() > MAX_ASSETS
        || request.declared_media_asset_count > MAX_ASSETS.saturating_sub(request.assets.len())
        || request.admitted_source_bytes > MAX_TOTAL_BYTES
        || request.declared_source_count > super::MAX_SOURCES
        || request.duration_frames == 0
        || request.duration_frames > 1_000_000
        || request.frame_index >= request.duration_frames
        || rate.numerator == 0
        || rate.denominator == 0
    {
        return Err("Invalid Remotion produced-assets frame context".into());
    }
    let fps = f64::from(rate.numerator) / f64::from(rate.denominator);
    let seconds = f64::from(request.duration_frames) / fps;
    if fps > 120000.0 || !seconds.is_finite() || seconds > MAX_SECONDS {
        return Err("Invalid Remotion produced-assets composition clock".into());
    }
    let mut ids = HashSet::new();
    let mut total = request.admitted_source_bytes;
    let mut inline = Vec::new();
    let mut artifacts = Vec::new();
    for asset in request.assets {
        let bytes = match asset {
            Asset::InlineAudio {
                id,
                audio,
                frame,
                timestamp,
                duration,
                tone_frequency,
            } => {
                if !identity(&id)
                    || !ids.insert(id.clone())
                    || frame != request.frame_index
                    || audio.is_empty()
                    || audio.len() % 2 != 0
                    || audio.len() as u64 * 2 > MAX_BYTES
                    || !timestamp.is_finite()
                    || timestamp.abs() > MAX_SECONDS * 1e6
                    || !duration.is_finite()
                    || duration <= 0.0
                    || (duration - (audio.len() as f64 / 2.0 / 48000.0 * 1e6)).abs() > 0.01
                    || audio.iter().any(|value| !value.is_finite())
                    || !tone_frequency.is_finite()
                    || !(0.01..=2.0).contains(&tone_frequency)
                {
                    return Err("Invalid native Remotion inline-audio registration/layout".into());
                }
                let start = native_sample_position(f64::from(frame) / fps);
                if start + audio.len() as u64 / 2 > (seconds * 48000.0).ceil() as u64 + 2 {
                    return Err("Native inline PCM exceeds its canonical composition window".into());
                }
                let bytes = audio.len() as u64 * 2;
                // Fixed renderer constructs new Int16Array(asset.audio), also
                // for the number[] wire representation. JS ToInt16 truncates
                // and wraps; it does not clamp or normalize author PCM twice.
                let pcm16: Vec<i16> = audio
                    .iter()
                    .map(|value| value.trunc().rem_euclid(65536.0) as u16 as i16)
                    .collect();
                inline.push(json!({"id":id,"collectionFrame":frame,"absoluteStartSample":start,
                    "sampleRate":48000,"channels":2,"sampleFormat":"s16le","frames":audio.len()/2,
                    "pcm16":pcm16,"toneFrequency":tone_frequency,"gainApplied":true,
                    "nativeTimestampMicroseconds":timestamp,"nativeDurationMicroseconds":duration,
                    "overlapPolicy":"same-id-later-frame-overwrites","requiresTonePreparation":tone_frequency!=1.0}));
                if request.declared_source_count + inline.len() > super::MAX_SOURCES {
                    return Err(
                        "Native produced PCM and declared sources exceed the source count budget"
                            .into(),
                    );
                }
                bytes
            }
            Asset::Artifact {
                id,
                filename,
                frame,
                download_behavior,
                content_type,
                content,
            } => {
                if !identity(&id)
                    || !ids.insert(id.clone())
                    || !logical_filename(&filename)
                    || frame.unsigned_abs() > u64::from(request.duration_frames)
                    || matches!(&download_behavior,Some(Download::Download{file_name:Some(name)}) if !logical_filename(name))
                {
                    return Err("Invalid native Remotion artifact identity/filename/frame".into());
                }
                let (body, bytes) = match (content_type.as_str(), content) {
                    ("thumbnail", None) => (None, Vec::new()),
                    ("text", Some(content)) if content.len() as u64 <= MAX_BYTES => {
                        let bytes = content.as_bytes().to_vec();
                        (Some(json!({"encoding":"utf8","data":content})), bytes)
                    }
                    ("binary", Some(content)) => {
                        let bytes = base64_bytes(&content)?;
                        (Some(json!({"encoding":"base64","data":content})), bytes)
                    }
                    _ => return Err("Invalid native Remotion artifact content discriminant".into()),
                };
                if bytes.len() as u64 > MAX_BYTES {
                    return Err("Native artifact exceeds its byte budget".into());
                }
                artifacts.push(json!({"id":id,"filename":filename,"nativeLocalFrame":frame,
                    "collectionFrame":request.frame_index,"contentType":content_type,"downloadBehavior":download_behavior,
                    "body":body,"byteLength":bytes.len(),"sha256":if body.is_some(){Some(format!("{:x}",Sha256::digest(&bytes)))}else{None},
                    "requiresCapture":if body.is_none(){Some("exact-frame-png")}else{None},
                    "outputStatus":"requires-owned-host-artifact-sink"}));
                bytes.len() as u64
            }
        };
        total = total
            .checked_add(bytes)
            .ok_or("Native produced bytes overflow")?;
        if total > MAX_TOTAL_BYTES {
            return Err("Native produced assets exceed the total byte budget".into());
        }
    }
    Ok(
        json!({"version":1,"nativeVersion":"4.0.440","stage":"bounded-produced-assets-admission",
        "executionReady":false,"byteLength":total-request.admitted_source_bytes,"combinedSourceByteLength":total,
        "inlineAudio":inline,"artifacts":artifacts}),
    )
}

#[bridge::export]
pub fn resolve_remotion_produced_assets_json(input: String) -> String {
    let result = (|| {
        if input.len() > MAX_OBSERVATION_BYTES {
            return Err("Native produced-assets JSON exceeds the observation byte budget".into());
        }
        let request = serde_json::from_str(&input)
            .map_err(|error| format!("Invalid native produced-assets JSON: {error}"))?;
        let plan = admit(request)?;
        let output = json!({"plan":plan}).to_string();
        if output.len() > MAX_OBSERVATION_BYTES {
            return Err("Native produced-assets output exceeds its byte budget".into());
        }
        Ok(output)
    })();
    result.unwrap_or_else(|error: String| json!({"error":error}).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> Value {
        json!({"version":1,"frameIndex":3,"frameRate":{"numerator":25,"denominator":1},
            "durationFrames":10,"assets":[{"type":"inline-audio","id":"native-pcm","audio":[32768.9,-32769.9,65536.1,-0.9],
                "frame":3,"timestamp":999000,"duration":2.0/48000.0*1e6,"toneFrequency":1},
                {"type":"artifact","id":"text","filename":"sidecars/caption.txt","frame":-2,
                    "contentType":"text","content":"中文😀\n","downloadBehavior":null},
                {"type":"artifact","id":"image","filename":"sidecars/frame.png","frame":3,
                    "contentType":"thumbnail","downloadBehavior":{"type":"download","fileName":null}}]})
    }
    fn resolve(value: &Value) -> Value {
        serde_json::from_str(&resolve_remotion_produced_assets_json(value.to_string())).unwrap()
    }

    #[test]
    fn actual_native_layout_clock_wrap_and_output_roles_survive() {
        let result = resolve(&request());
        assert!(result.get("error").is_none(), "{result}");
        let plan = &result["plan"];
        assert_eq!(plan["inlineAudio"][0]["absoluteStartSample"], 5760);
        assert_eq!(
            plan["inlineAudio"][0]["pcm16"],
            json!([-32768, 32767, 0, 0])
        );
        assert_eq!(plan["inlineAudio"][0]["gainApplied"], true);
        assert_eq!(plan["artifacts"][0]["byteLength"], 11);
        assert_eq!(plan["artifacts"][0]["nativeLocalFrame"], -2);
        assert_eq!(plan["artifacts"][0]["collectionFrame"], 3);
        assert_eq!(plan["artifacts"][1]["requiresCapture"], "exact-frame-png");
        assert!(plan["artifacts"][1]["body"].is_null());
        assert_eq!(plan["executionReady"], false);
    }
    #[test]
    fn native_produced_rejects_layout_clock_identity_filename_and_content_forgery() {
        for (pointer, value) in [
            ("/assets/0/frame", json!(2)),
            ("/assets/0/audio", json!([1, 2, 3])),
            ("/assets/0/duration", json!(100)),
            ("/assets/0/toneFrequency", json!(3)),
            ("/assets/1/id", json!("native-pcm")),
            ("/assets/1/filename", json!("../escaped")),
            ("/assets/1/filename", json!("C:/escaped")),
            ("/assets/1/filename", json!("AUX.txt")),
            ("/assets/1/filename", json!("a\\b.txt")),
            ("/assets/1/filename", json!("a/./b.txt")),
            ("/assets/1/contentType", json!("thumbnail")),
            ("/frameIndex", json!(10)),
            ("/frameRate/numerator", json!(0)),
        ] {
            let mut input = request();
            *input.pointer_mut(pointer).unwrap() = value;
            assert!(
                resolve(&input)["error"].is_string(),
                "{pointer}: {}",
                resolve(&input)
            );
        }
        let mut input = request();
        input["assets"][2]["content"] = json!("metadata is not a PNG");
        assert!(resolve(&input)["error"].is_string());
    }
    #[test]
    fn canonical_binary_bytes_and_combined_budgets_are_not_relaxed() {
        let mut input = request();
        input["assets"][1]["contentType"] = json!("binary");
        input["assets"][1]["content"] = json!("AP+A");
        let result = resolve(&input);
        assert_eq!(result["plan"]["artifacts"][0]["byteLength"], 3);
        for encoded in ["AB==", "AA=", "A===", "AA== "] {
            input["assets"][1]["content"] = json!(encoded);
            assert!(resolve(&input)["error"].is_string());
        }
        for (key, value) in [
            ("declaredMediaAssetCount", json!(64)),
            ("declaredSourceCount", json!(64)),
            ("admittedSourceBytes", json!(MAX_TOTAL_BYTES)),
        ] {
            let mut input = request();
            input[key] = value;
            assert!(resolve(&input)["error"].is_string(), "{key}");
        }
    }
    #[test]
    fn native_empty_and_whitespace_artifacts_remain_real_fulfilled_bytes() {
        for (kind, content, length) in [("text", "", 0), ("text", " \n\t", 3), ("binary", "", 0)] {
            let mut input = request();
            input["assets"][1]["contentType"] = json!(kind);
            input["assets"][1]["content"] = json!(content);
            let output = resolve(&input);
            assert!(output.get("error").is_none(), "{output}");
            assert_eq!(output["plan"]["artifacts"][0]["byteLength"], length);
            assert_eq!(output["plan"]["artifacts"][0]["body"]["data"], content);
            assert!(output["plan"]["artifacts"][0]["sha256"].is_string());
        }
    }
    #[test]
    fn original_floor_clock_snaps_float_error_but_never_places_from_microseconds() {
        assert_eq!(native_sample_position(5.1), 244800);
        assert_eq!(native_sample_position(0.1234567), 5925);
        let mut input = request();
        input["assets"][0]["timestamp"] = json!(-200000);
        assert_eq!(
            resolve(&input)["plan"]["inlineAudio"][0]["absoluteStartSample"],
            5760
        );
    }
}

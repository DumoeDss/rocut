//! Byte-bound encoded-media facts. Platform adapters supply demux observations,
//! never authored FPS/dimensions. Bounded packet statistics are always average.
use bridge::export;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const SAFE: u64 = 9_007_199_254_740_991;
const MAX_BYTES: usize = 512 * 1024 * 1024;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MediaFacts {
    schema_version: u8,
    source: String,
    sha256: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    frame_rate: Option<FrameRate>,
    #[serde(skip_serializing_if = "Option::is_none")]
    alpha: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    animation: Option<Animation>,
    #[serde(skip_serializing_if = "Option::is_none")]
    audio: Option<Audio>,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FrameRate {
    numerator: u64,
    denominator: u64,
    mode: String,
    samples: u64,
    complete: bool,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Animation {
    pub(super) frame_count: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) loop_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) duration_ticks: Option<u64>,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Audio {
    channels: u64,
    sample_rate: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    layout: Option<String>,
}
#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Observations {
    #[serde(default)]
    mime_type: String,
    packet_count: Option<u64>,
    average_packet_rate: Option<f64>,
    audio: Option<Audio>,
    video_packets: Option<frame_rate::VideoPackets>,
}
fn positive(n: u64) -> bool {
    n > 0 && n <= SAFE
}
fn valid(f: &MediaFacts) -> bool {
    f.schema_version == 1
        && f.source == "byte-probe"
        && f.sha256.len() == 64
        && f.sha256
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
        && f.frame_rate.as_ref().is_none_or(|r| {
            positive(r.numerator)
                && positive(r.denominator)
                && positive(r.samples)
                && matches!(r.mode.as_str(), "constant" | "variable" | "average")
                && (r.mode == "average" || r.complete)
        })
        && f.animation.as_ref().is_none_or(|a| {
            positive(a.frame_count)
                && a.loop_count.is_none_or(|n| n <= SAFE)
                && a.duration_ticks.is_none_or(|n| n <= SAFE)
        })
        && f.audio.as_ref().is_none_or(|a| {
            positive(a.channels)
                && positive(a.sample_rate)
                && a.layout.as_ref().is_none_or(|s| {
                    !s.trim().is_empty() && s.len() <= 500 && !s.chars().any(char::is_control)
                })
        })
}
#[export]
pub fn validate_media_facts_json(input: String) -> String {
    match serde_json::from_str::<MediaFacts>(&input) {
        Ok(f) if valid(&f) => serde_json::to_string(&f).unwrap(),
        _ => "null".into(),
    }
}
fn gcd(mut a: u64, mut b: u64) -> u64 {
    while b != 0 {
        let r = a % b;
        a = b;
        b = r;
    }
    a
}

/// u32LE JSON length, UTF-8 demux observations, then the complete source bytes.
/// Hashing and all fact interpretation happen here, independent of JS hashing.
#[export]
pub fn inspect_media_facts_bytes(input: Vec<u8>) -> String {
    let result = (|| -> Option<MediaFacts> {
        let length = u32::from_le_bytes(input.get(..4)?.try_into().ok()?) as usize;
        if length > 64 * 1024 {
            return None;
        }
        let header = input.get(4..4 + length)?;
        let body = input.get(4 + length..)?;
        if body.is_empty() || body.len() > MAX_BYTES {
            return None;
        }
        let o: Observations = serde_json::from_slice(header).ok()?;
        let mut f = MediaFacts {
            schema_version: 1,
            source: "byte-probe".into(),
            sha256: format!("{:x}", Sha256::digest(body)),
            frame_rate: None,
            alpha: None,
            animation: None,
            audio: None,
        };
        if let (Some(samples), Some(rate)) = (o.packet_count, o.average_packet_rate) {
            // Fixed decimal representation of measured average, not inferred CFR.
            let n = (rate * 1_000_000.0).round();
            if positive(samples) && rate.is_finite() && n >= 1.0 && n <= SAFE as f64 {
                let n = n as u64;
                let d = gcd(n, 1_000_000);
                f.frame_rate = Some(FrameRate {
                    numerator: n / d,
                    denominator: 1_000_000 / d,
                    mode: "average".into(),
                    samples,
                    complete: false,
                });
            }
        }
        if let Some(packets) = o.video_packets {
            if let Some(rate) = frame_rate::inspect(packets) {
                f.frame_rate = Some(rate);
            }
        }
        if let Some(a) = o.audio {
            if positive(a.channels) && positive(a.sample_rate) {
                f.audio = Some(a);
            }
        }
        // Existing complete static container admission checks CRC/chunk bounds,
        // ordering and exact termination. Animated/unsupported images yield no
        // animation or alpha claim, rather than being mislabeled static.
        if matches!(
            o.mime_type.as_str(),
            "image/png" | "image/webp" | "image/jpeg"
        ) && crate::image_sequence::inspect_encoded_image(&o.mime_type, body).is_ok()
        {
            f.animation = Some(Animation {
                frame_count: 1,
                loop_count: None,
                duration_ticks: None,
            });
            if o.mime_type == "image/png" {
                let color = body[25];
                // tRNS is transparency metadata, not an encoded alpha channel.
                f.alpha = Some(matches!(color, 4 | 6));
            } else if o.mime_type == "image/jpeg" {
                f.alpha = Some(false);
            } else {
                f.alpha = webp_alpha(body);
            }
        }
        if o.mime_type == "image/gif" {
            if let Some((animation, alpha)) = gif::inspect(body) {
                f.animation = Some(animation);
                f.alpha = Some(alpha);
            }
        }
        valid(&f).then_some(f)
    })();
    serde_json::to_string(&result).unwrap()
}
// Called only after complete static WebP container admission.
fn webp_alpha(body: &[u8]) -> Option<bool> {
    let mut p = 12;
    while p + 8 <= body.len() {
        let n = u32::from_le_bytes(body[p + 4..p + 8].try_into().ok()?) as usize;
        let data = body.get(p + 8..p + 8 + n)?;
        match &body[p..p + 4] {
            b"VP8X" => return Some(data[0] & 16 != 0),
            b"VP8L" => return Some(data[4] & 16 != 0),
            b"VP8 " => return Some(false),
            _ => {}
        }
        p += 8 + n + (n & 1);
    }
    None
}
mod frame_rate;
mod gif;

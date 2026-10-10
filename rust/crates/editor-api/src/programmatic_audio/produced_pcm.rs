//! Original native inline writes retain their IDs and full source history.
//! Owned WAV transport is not a declared asset or an upstream encoded source.
use super::produced::resolve_remotion_produced_assets_json;
use super::range::{Rate, resolve_range};
use super::{
    MAX_ANALYSIS_FRAMES, MAX_OBSERVATION_BYTES, MAX_PCM_BYTES, MAX_SOURCES, MAX_TOTAL_BYTES,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::HashMap;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Frame {
    frame_index: u32,
    assets: Vec<Value>,
    declared_media_asset_count: usize,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SourceRequest {
    version: u32,
    frame_rate: Rate,
    duration_frames: u32,
    declared_source_count: usize,
    admitted_source_bytes: u64,
    frames: Vec<Frame>,
}
struct Source {
    id: String,
    tone: f64,
    pcm: Vec<i16>,
}

fn put_u16(body: &mut Vec<u8>, value: u16) {
    body.extend_from_slice(&value.to_le_bytes());
}
fn put_u32(body: &mut Vec<u8>, value: u32) {
    body.extend_from_slice(&value.to_le_bytes());
}
fn wav(pcm: &[i16]) -> Vec<u8> {
    let bytes = pcm.len() as u32 * 2;
    let mut body = Vec::with_capacity(bytes as usize + 44);
    body.extend_from_slice(b"RIFF");
    put_u32(&mut body, bytes + 36);
    body.extend_from_slice(b"WAVEfmt ");
    put_u32(&mut body, 16);
    put_u16(&mut body, 1);
    put_u16(&mut body, 2);
    put_u32(&mut body, 48000);
    put_u32(&mut body, 192000);
    put_u16(&mut body, 4);
    put_u16(&mut body, 16);
    body.extend_from_slice(b"data");
    put_u32(&mut body, bytes);
    for sample in pcm {
        body.extend_from_slice(&sample.to_le_bytes());
    }
    body
}

#[bridge::export]
pub fn prepare_remotion_inline_audio_sources_json(input: String) -> Result<Vec<u8>, String> {
    if input.len() > MAX_OBSERVATION_BYTES {
        return Err("Native inline history exceeds its observation byte budget".into());
    }
    let request: SourceRequest = serde_json::from_str(&input).map_err(|error| error.to_string())?;
    if request.duration_frames == 0
        || request.duration_frames > MAX_ANALYSIS_FRAMES
        || request.frames.len() != request.duration_frames as usize
        || request.declared_source_count > MAX_SOURCES
        || request.admitted_source_bytes > MAX_TOTAL_BYTES
    {
        return Err("Native inline preparation requires the full bounded canonical history".into());
    }
    // Existing rational range admission, including native sample/PCM policy.
    resolve_range(
        request.version,
        &request.frame_rate,
        48000,
        0,
        request.duration_frames,
    )?;
    let fps = f64::from(request.frame_rate.numerator) / f64::from(request.frame_rate.denominator);
    let native_frames = (f64::from(request.duration_frames) / fps * 48000.0).round() as usize;
    let mut sources: Vec<Source> = Vec::new();
    let mut ids: HashMap<String, usize> = HashMap::new();
    let mut native_bytes = 0u64;
    let mut raw_bytes = request.admitted_source_bytes;
    for (index, frame) in request.frames.into_iter().enumerate() {
        if frame.frame_index as usize != index {
            return Err("Native inline history has missing/reordered frames".into());
        }
        let normalized:Value=serde_json::from_str(&resolve_remotion_produced_assets_json(json!({"version":request.version,
            "frameIndex":frame.frame_index,"frameRate":{"numerator":request.frame_rate.numerator,"denominator":request.frame_rate.denominator},
            "durationFrames":request.duration_frames,"assets":frame.assets,"declaredMediaAssetCount":frame.declared_media_asset_count,
            "declaredSourceCount":request.declared_source_count,"admittedSourceBytes":request.admitted_source_bytes}).to_string())).map_err(|error|error.to_string())?;
        if let Some(error) = normalized.get("error") {
            return Err(error
                .as_str()
                .unwrap_or("Invalid inline native registration")
                .into());
        }
        raw_bytes = raw_bytes
            .checked_add(normalized["plan"]["byteLength"].as_u64().unwrap())
            .ok_or("Native inline history byte count overflow")?;
        if raw_bytes > MAX_TOTAL_BYTES {
            return Err(
                "Native produced history and declared sources exceed the total byte budget".into(),
            );
        }
        for chunk in normalized["plan"]["inlineAudio"].as_array().unwrap() {
            let id = chunk["id"].as_str().unwrap();
            let tone = chunk["toneFrequency"].as_f64().unwrap();
            let source_index = if let Some(index) = ids.get(id) {
                *index
            } else {
                if sources.len() + request.declared_source_count >= MAX_SOURCES {
                    return Err("Native inline sources exceed the combined source budget".into());
                }
                native_bytes = native_bytes
                    .checked_add(native_frames as u64 * 4 + 44)
                    .ok_or("Native inline source geometry overflow")?;
                if native_bytes > MAX_TOTAL_BYTES || native_bytes > MAX_PCM_BYTES {
                    return Err(
                        "Full native inline source history exceeds its owned PCM budget".into(),
                    );
                }
                let index = sources.len();
                ids.insert(id.to_owned(), index);
                sources.push(Source {
                    id: id.to_owned(),
                    tone,
                    pcm: vec![0; native_frames * 2],
                });
                index
            };
            let source = &mut sources[source_index];
            if source.tone != tone {
                return Err(
                    "Native inline toneFrequency changed across the same authored asset".into(),
                );
            }
            let start = chunk["absoluteStartSample"].as_u64().unwrap() as usize * 2;
            let pcm = chunk["pcm16"].as_array().unwrap();
            let length = pcm.len().min(source.pcm.len().saturating_sub(start));
            for sample in 0..length {
                source.pcm[start + sample] = pcm[sample].as_i64().unwrap() as i16;
            }
        }
    }
    let descriptors:Vec<Value>=sources.iter().map(|source|json!({"kind":"native-generated-inline-pcm","id":source.id,
        "byteLength":source.pcm.len()*2+44,"nativeFrames":native_frames,"sampleRate":48000,"channels":2,"toneFrequency":source.tone,
        "toneFilter":if source.tone==1.0{None}else{Some(format!("asetrate=48000*{},aresample=48000,atempo=1/{}",source.tone,source.tone))},
        "maxToneBytes":MAX_PCM_BYTES,"maxDecodedBytes":MAX_PCM_BYTES,"gainApplied":true})).collect();
    let header=json!({"version":1,"sourceClockProfile":"remotion-4.0.440-native-inline-frame-writes-v1","sources":descriptors}).to_string();
    let mut output = (header.len() as u32).to_le_bytes().to_vec();
    output.extend_from_slice(header.as_bytes());
    for source in sources {
        output.extend_from_slice(&wav(&source.pcm));
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn asset(id: &str, frame: u32, pcm: Vec<i16>, tone: f64) -> Value {
        json!({"type":"inline-audio","id":id,"frame":frame,"audio":pcm,
            "timestamp":999.0,"duration":pcm.len() as f64/2.0/48000.0*1e6,"toneFrequency":tone})
    }
    fn history(frames: Vec<Value>) -> String {
        json!({"version":1,"frameRate":{"numerator":24000,"denominator":1},"durationFrames":2,
            "declaredSourceCount":0,"admittedSourceBytes":0,"frames":frames})
        .to_string()
    }
    fn entry(index: u32, assets: Vec<Value>) -> Value {
        json!({"frameIndex":index,"assets":assets,"declaredMediaAssetCount":0})
    }
    #[test]
    fn later_native_writes_overwrite_and_keep_first_id_order() {
        let packed = prepare_remotion_inline_audio_sources_json(history(vec![
            entry(
                0,
                vec![
                    asset("a", 0, vec![1, 2, 3, 4, 7, 8], 1.0),
                    asset("b", 0, vec![8, 9], 1.0),
                ],
            ),
            entry(1, vec![asset("a", 1, vec![5, 6], 1.0)]),
        ]))
        .unwrap();
        let length = u32::from_le_bytes(packed[..4].try_into().unwrap()) as usize;
        let manifest: Value = serde_json::from_slice(&packed[4..4 + length]).unwrap();
        assert_eq!(manifest["sources"][0]["id"], "a");
        assert_eq!(manifest["sources"][1]["id"], "b");
        let pcm = &packed[4 + length + 44..4 + length + 56];
        let samples: Vec<i16> = pcm
            .chunks_exact(2)
            .map(|s| i16::from_le_bytes(s.try_into().unwrap()))
            .collect();
        assert_eq!(samples, vec![1, 2, 3, 4, 5, 6]);
    }
    #[test]
    fn full_native_history_and_stable_tone_are_required() {
        assert!(
            prepare_remotion_inline_audio_sources_json(history(vec![entry(0, vec![])])).is_err()
        );
        assert!(
            prepare_remotion_inline_audio_sources_json(history(vec![
                entry(1, vec![]),
                entry(0, vec![])
            ]))
            .is_err()
        );
        assert!(
            prepare_remotion_inline_audio_sources_json(history(vec![
                entry(0, vec![asset("a", 0, vec![1, 2], 1.0)]),
                entry(1, vec![asset("a", 1, vec![1, 2], 1.1)])
            ]))
            .is_err()
        );
    }
    fn mix(format: &str, rate: u32, body: Vec<u8>) -> Result<Vec<u8>, String> {
        let request=json!({"version":1,"frameRate":{"numerator":120000,"denominator":1},"durationFrames":6,
            "firstFrame":3,"frameCount":3,"sampleRate":rate,"baseByteLength":8,"inlineByteLengths":[body.len()],"inlineFormats":[format]}).to_string();
        let mut input = (request.len() as u32).to_le_bytes().to_vec();
        input.extend_from_slice(request.as_bytes());
        input.extend_from_slice(&[0; 8]);
        input.extend_from_slice(&body);
        mix_remotion_produced_audio_pcm(input)
    }
    #[test]
    fn s16_native_crop_adds_once_and_rejects_unfulfilled_rate() {
        let body: Vec<u8> = [0i16, 0, 16384, -16384]
            .into_iter()
            .flat_map(i16::to_le_bytes)
            .collect();
        let output = mix("s16le", 48000, body.clone()).unwrap();
        assert_eq!(f32::from_le_bytes(output[..4].try_into().unwrap()), 0.5);
        assert_eq!(f32::from_le_bytes(output[4..].try_into().unwrap()), -0.5);
        assert!(mix("s16le", 44100, body).is_err());
    }
    #[test]
    fn prepared_f32_crops_zero_padded_eof_and_rejects_nan() {
        assert_eq!(mix("f32le", 44100, vec![0; 8]).unwrap(), vec![0; 8]);
        let body: Vec<u8> = [0.0f32, 0.0, f32::NAN, 0.0]
            .into_iter()
            .flat_map(f32::to_le_bytes)
            .collect();
        assert!(mix("f32le", 48000, body).is_err());
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MixRequest {
    version: u32,
    frame_rate: Rate,
    duration_frames: u32,
    first_frame: u32,
    frame_count: u32,
    sample_rate: u32,
    base_byte_length: u64,
    inline_byte_lengths: Vec<u64>,
    inline_formats: Vec<String>,
}

#[bridge::export]
pub fn mix_remotion_produced_audio_pcm(input: Vec<u8>) -> Result<Vec<u8>, String> {
    if input.len() < 4 || input.len() as u64 > MAX_PCM_BYTES + MAX_OBSERVATION_BYTES as u64 + 4 {
        return Err("Remotion inline mix envelope exceeds its budget".into());
    }
    let header = u32::from_le_bytes(input[..4].try_into().unwrap()) as usize;
    if header > MAX_OBSERVATION_BYTES || header + 4 > input.len() {
        return Err("Invalid native inline mix header".into());
    }
    let request: MixRequest =
        serde_json::from_slice(&input[4..header + 4]).map_err(|error| error.to_string())?;
    if request.duration_frames == 0
        || request
            .first_frame
            .checked_add(request.frame_count)
            .is_none_or(|end| end > request.duration_frames)
        || request.inline_byte_lengths.len() > MAX_SOURCES
        || request.inline_formats.len() != request.inline_byte_lengths.len()
    {
        return Err("Invalid native inline mix canonical range".into());
    }
    let range = resolve_range(
        request.version,
        &request.frame_rate,
        request.sample_rate,
        request.first_frame,
        request.frame_count,
    )?;
    let expected = range.output_frames * 8;
    let mut bytes = request.base_byte_length;
    for (length, format) in request
        .inline_byte_lengths
        .iter()
        .zip(&request.inline_formats)
    {
        let stride = match format.as_str() {
            "f32le" => 8,
            "s16le" if request.sample_rate == 48000 => 4,
            _ => return Err("Native inline mix format/rate has no fulfilled preparation".into()),
        };
        if *length % stride != 0 || *length > MAX_PCM_BYTES {
            return Err("Invalid prepared native inline PCM geometry".into());
        }
        bytes = bytes
            .checked_add(*length)
            .ok_or("Inline PCM byte count overflow")?;
    }
    if request.base_byte_length != expected
        || bytes > MAX_PCM_BYTES
        || bytes != input.len() as u64 - header as u64 - 4
    {
        return Err("Native inline mix buffers disagree with the checked range/budget".into());
    }
    let payload = &input[header + 4..];
    let mut output = payload[..expected as usize].to_vec();
    let mut offset = expected as usize;
    for (length, format) in request
        .inline_byte_lengths
        .into_iter()
        .zip(request.inline_formats)
    {
        let body = &payload[offset..offset + length as usize];
        offset += length as usize;
        for frame in 0..range.output_frames {
            let source = range.sample_origin + frame;
            for channel in 0..2u64 {
                let target = (frame * 2 + channel) as usize * 4;
                let mut mixed = f32::from_le_bytes(output[target..target + 4].try_into().unwrap());
                let width = if format == "s16le" { 2 } else { 4 };
                let position = (source * 2 + channel) * width;
                if position + width <= body.len() as u64 {
                    mixed += if width == 2 {
                        f32::from(i16::from_le_bytes(
                            body[position as usize..position as usize + 2]
                                .try_into()
                                .unwrap(),
                        )) / 32768.0
                    } else {
                        f32::from_le_bytes(
                            body[position as usize..position as usize + 4]
                                .try_into()
                                .unwrap(),
                        )
                    };
                }
                if !mixed.is_finite() {
                    return Err("Nonfinite native inline canonical PCM sum".into());
                }
                output[target..target + 4].copy_from_slice(&mixed.to_le_bytes());
            }
        }
    }
    // The no-inline path still must not publish nonfinite base PCM.
    if output
        .chunks_exact(4)
        .any(|bytes| !f32::from_le_bytes(bytes.try_into().unwrap()).is_finite())
    {
        return Err("Nonfinite base PCM in native produced mixer".into());
    }
    Ok(output)
}

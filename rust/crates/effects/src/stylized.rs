use bridge::export;
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::BTreeMap;
use time::{FrameRate, MediaTime};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    effect_type: String,
    params: BTreeMap<String, f64>,
    local_time: i64,
    frame_rate: FrameRate,
}

// Clip-local effect time deliberately does not follow source trim or playback rate:
// a held video frame may still carry an animated effect. Transition handles pass
// signed local times; Euclidean flooring preserves the same rational frame grid.
fn resolve(r: Request) -> Result<Value, String> {
    if r.effect_type == "canvas" {
        return crate::canvas::resolve(&r.params, r.local_time, r.frame_rate);
    }
    if r.effect_type == "frost" {
        return crate::frost::resolve(&r.params, r.local_time, r.frame_rate);
    }
    if r.effect_type == "bubble" {
        return crate::bubble::resolve(&r.params, r.local_time, r.frame_rate);
    }
    if r.effect_type == "blaze" {
        return crate::blaze::resolve(&r.params, r.local_time, r.frame_rate);
    }
    if r.effect_type == "flame-wrap" {
        return crate::flame_wrap::resolve(&r.params, r.local_time, r.frame_rate);
    }
    if r.effect_type == "clouds" {
        return crate::clouds::resolve(&r.params, r.local_time, r.frame_rate);
    }
    if r.effect_type == "droplets" {
        return crate::droplets::resolve(&r.params, r.local_time, r.frame_rate);
    }
    if r.effect_type == "liquid" {
        return crate::liquid_params::resolve(&r.params, r.local_time, r.frame_rate);
    }
    if matches!(r.effect_type.as_str(), "ripple" | "force-field") {
        return crate::wave_events::resolve_wave_effect(
            &r.effect_type,
            &r.params,
            r.local_time,
            r.frame_rate,
        );
    }
    if r.local_time.unsigned_abs() > 9_007_199_254_740_991 {
        return Err("Effect time must be safe integer ticks".into());
    }
    let frame = MediaTime::from_ticks(r.local_time)
        .to_frame_floor(r.frame_rate)
        .filter(|_| r.frame_rate.numerator <= 120_000 && r.frame_rate.denominator <= 1001)
        .ok_or("Effect frame rate must have bounded integral ticks/frame")?;
    let definition = crate::stylized_catalog::definitions()
        .into_iter()
        .find(|d| d.id == r.effect_type)
        .ok_or("Unknown stylized effect")?;
    if r.params
        .keys()
        .any(|key| !definition.fields.iter().any(|f| f.key == key))
    {
        return Err("Unknown stylized effect parameter".into());
    }
    let mut uniforms = BTreeMap::new();
    for field in definition.fields {
        let raw = r.params.get(field.key).copied().unwrap_or(field.default);
        if !raw.is_finite() {
            return Err("Effect parameters must be finite".into());
        }
        let value = raw.clamp(field.min, field.max);
        // Continuous controls retain interpolated values. Discrete controls are
        // rounded here, not in a second app-specific normalizer.
        uniforms.insert(
            field.key,
            if field.step == 1.0 {
                value.round()
            } else {
                value
            },
        );
    }
    // Exact f32 integer, including negative handles. Period is > 6 days at 30fps.
    uniforms.insert(
        "frame",
        if definition.animated {
            frame.rem_euclid(16_777_216) as f64
        } else {
            0.0
        },
    );
    let passes = if uniforms["amount"] == 0.0 {
        vec![]
    } else {
        vec![json!({"shader": definition.id, "uniforms": uniforms})]
    };
    Ok(json!({"version": 1, "frameIndex": frame, "passes": passes}))
}

#[export]
pub fn resolve_stylized_effect_json(input: String) -> String {
    let result = serde_json::from_str::<Request>(&input)
        .map_err(|e| e.to_string())
        .and_then(resolve);
    match result {
        Ok(value) => value.to_string(),
        Err(error) => json!({"error": error}).to_string(),
    }
}

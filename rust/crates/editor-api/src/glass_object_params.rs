//! Versioned material parameters only; scene time and resources belong to the source.

use serde::{Deserialize, Serialize};

#[cfg(test)]
#[path = "glass_object_params_tests.rs"]
mod tests;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlassObjectParams {
    pub version: u8,
    pub transmission: f64,
    pub ior: f64,
    pub thickness: f64,
    pub roughness: f64,
    pub dispersion: f64,
    pub attenuation_distance: f64,
    pub environment_intensity: f64,
    pub color: String,
}

impl Default for GlassObjectParams {
    fn default() -> Self {
        Self {
            version: 1,
            transmission: 1.0,
            ior: 1.5,
            thickness: 0.5,
            roughness: 0.1,
            dispersion: 0.0,
            attenuation_distance: 1000.0,
            environment_intensity: 1.0,
            color: "#ffffff".into(),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
struct Input {
    version: u8,
    transmission: f64,
    ior: f64,
    thickness: f64,
    roughness: f64,
    dispersion: f64,
    attenuation_distance: f64,
    environment_intensity: f64,
    color: String,
}

impl Default for Input {
    fn default() -> Self {
        let defaults = GlassObjectParams::default();
        Self {
            version: 0,
            transmission: defaults.transmission,
            ior: defaults.ior,
            thickness: defaults.thickness,
            roughness: defaults.roughness,
            dispersion: defaults.dispersion,
            attenuation_distance: defaults.attenuation_distance,
            environment_intensity: defaults.environment_intensity,
            color: defaults.color,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct GlassObjectParamsError {
    pub code: &'static str,
    pub path: String,
    pub message: String,
}

fn error(code: &'static str, path: &str, message: &str) -> GlassObjectParamsError {
    GlassObjectParamsError {
        code,
        path: path.into(),
        message: message.into(),
    }
}

impl GlassObjectParams {
    pub fn validate(&self) -> Result<(), GlassObjectParamsError> {
        if self.version != 1 {
            return Err(error(
                "version",
                "version",
                "Glass Object requires version 1",
            ));
        }
        for (key, value, minimum, maximum) in [
            ("transmission", self.transmission, 0.0, 1.0),
            ("ior", self.ior, 1.0, 2.333),
            ("thickness", self.thickness, 0.0, 64.0),
            ("roughness", self.roughness, 0.0, 1.0),
            ("dispersion", self.dispersion, 0.0, 1.0),
            (
                "attenuationDistance",
                self.attenuation_distance,
                0.001,
                1_000_000.0,
            ),
            (
                "environmentIntensity",
                self.environment_intensity,
                0.0,
                16.0,
            ),
        ] {
            if !value.is_finite() || !(minimum..=maximum).contains(&value) {
                return Err(error(
                    "range",
                    key,
                    "Glass Object requires a finite value within the declared range",
                ));
            }
        }
        let bytes = self.color.as_bytes();
        if bytes.len() != 7 || bytes[0] != b'#' || !bytes[1..].iter().all(u8::is_ascii_hexdigit) {
            return Err(error(
                "color",
                "color",
                "Glass Object color must be #RRGGBB",
            ));
        }
        Ok(())
    }
}

pub fn parse_glass_object_params_json(
    input: &str,
) -> Result<GlassObjectParams, GlassObjectParamsError> {
    let raw: Input = serde_json::from_str(input).map_err(|_| {
        error(
            "json",
            "params",
            "Glass Object requires a strict versioned parameter object",
        )
    })?;
    let params = GlassObjectParams {
        version: raw.version,
        transmission: raw.transmission,
        ior: raw.ior,
        thickness: raw.thickness,
        roughness: raw.roughness,
        dispersion: raw.dispersion,
        attenuation_distance: raw.attenuation_distance,
        environment_intensity: raw.environment_intensity,
        color: raw.color,
    };
    params.validate()?;
    Ok(params)
}

pub fn resolve_glass_object_params_json(input: String) -> String {
    match parse_glass_object_params_json(&input) {
        Ok(params) => serde_json::json!({ "version": 1, "ok": true, "params": params }).to_string(),
        Err(error) => serde_json::json!({ "version": 1, "ok": false, "error": error }).to_string(),
    }
}

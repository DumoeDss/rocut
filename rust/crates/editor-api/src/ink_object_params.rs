use serde::{Deserialize, Serialize};

#[cfg(test)]
#[path = "ink_object_params_tests.rs"]
mod tests;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InkObjectParams {
    pub version: u8,
    pub contour_width: f64,
    pub ink_density: f64,
    pub paper_texture: f64,
    pub paper_scale: f64,
    pub seed: u16,
    pub ink_color: String,
    pub paper_color: String,
}

impl Default for InkObjectParams {
    fn default() -> Self {
        Self {
            version: 1,
            contour_width: 2.0,
            ink_density: 0.85,
            paper_texture: 0.15,
            paper_scale: 32.0,
            seed: 19,
            ink_color: "#182026".into(),
            paper_color: "#f2ead8".into(),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
struct Input {
    version: u8,
    contour_width: f64,
    ink_density: f64,
    paper_texture: f64,
    paper_scale: f64,
    seed: u16,
    ink_color: String,
    paper_color: String,
}

impl Default for Input {
    fn default() -> Self {
        let p = InkObjectParams::default();
        Self {
            version: 0,
            contour_width: p.contour_width,
            ink_density: p.ink_density,
            paper_texture: p.paper_texture,
            paper_scale: p.paper_scale,
            seed: p.seed,
            ink_color: p.ink_color,
            paper_color: p.paper_color,
        }
    }
}

#[derive(Debug, PartialEq, Serialize)]
pub struct InkObjectParamsError {
    pub code: &'static str,
    pub path: String,
    pub message: String,
}

fn error(code: &'static str, path: &str, message: &str) -> InkObjectParamsError {
    InkObjectParamsError {
        code,
        path: path.into(),
        message: message.into(),
    }
}

impl InkObjectParams {
    pub fn validate(&self) -> Result<(), InkObjectParamsError> {
        if self.version != 1 {
            return Err(error("version", "version", "Ink Object requires version 1"));
        }
        for (key, value, min, max) in [
            ("contourWidth", self.contour_width, 0.0, 16.0),
            ("inkDensity", self.ink_density, 0.0, 1.0),
            ("paperTexture", self.paper_texture, 0.0, 1.0),
            ("paperScale", self.paper_scale, 1.0, 256.0),
        ] {
            if !value.is_finite() || !(min..=max).contains(&value) {
                return Err(error(
                    "range",
                    key,
                    "Ink Object requires a finite value in range",
                ));
            }
        }
        for (key, color) in [
            ("inkColor", &self.ink_color),
            ("paperColor", &self.paper_color),
        ] {
            let bytes = color.as_bytes();
            if bytes.len() != 7 || bytes[0] != b'#' || !bytes[1..].iter().all(u8::is_ascii_hexdigit)
            {
                return Err(error("color", key, "Ink Object color must be #RRGGBB"));
            }
        }
        Ok(())
    }
}

pub fn parse_ink_object_params_json(input: &str) -> Result<InkObjectParams, InkObjectParamsError> {
    let p: Input = serde_json::from_str(input).map_err(|_| {
        error(
            "json",
            "params",
            "Ink Object requires a strict versioned parameter object",
        )
    })?;
    let params = InkObjectParams {
        version: p.version,
        contour_width: p.contour_width,
        ink_density: p.ink_density,
        paper_texture: p.paper_texture,
        paper_scale: p.paper_scale,
        seed: p.seed,
        ink_color: p.ink_color,
        paper_color: p.paper_color,
    };
    params.validate()?;
    Ok(params)
}

pub fn resolve_ink_object_params_json(input: String) -> String {
    match parse_ink_object_params_json(&input) {
        Ok(params) => serde_json::json!({ "version": 1, "ok": true, "params": params }).to_string(),
        Err(error) => serde_json::json!({ "version": 1, "ok": false, "error": error }).to_string(),
    }
}

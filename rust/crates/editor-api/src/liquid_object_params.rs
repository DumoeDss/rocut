use effects::liquid_object::{
    LiquidObjectControls, LiquidObjectDomain, LiquidObjectFrame, deform_liquid_object_with_domain,
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
pub struct LiquidObjectParams {
    pub version: u8,
    pub enabled: bool,
    pub amount: f64,
    pub frequency: f64,
    pub speed: f64,
    pub twist: f64,
}

impl Default for LiquidObjectParams {
    fn default() -> Self {
        Self {
            version: 0,
            enabled: true,
            amount: 0.35,
            frequency: 4.0,
            speed: 1.0,
            twist: 0.5,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct LiquidObjectError {
    pub code: &'static str,
    pub path: &'static str,
    pub message: String,
}

fn error(code: &'static str, path: &'static str, message: impl Into<String>) -> LiquidObjectError {
    LiquidObjectError {
        code,
        path,
        message: message.into(),
    }
}

impl LiquidObjectParams {
    pub fn validate(&self) -> Result<(), LiquidObjectError> {
        if self.version != 1 {
            return Err(error(
                "version",
                "version",
                "Liquid Object requires explicit version 1",
            ));
        }
        for (path, value, lo, hi) in [
            ("amount", self.amount, 0.0, 1.0),
            ("frequency", self.frequency, 0.0, 16.0),
            ("speed", self.speed, 0.0, 16.0),
            ("twist", self.twist, -2.0, 2.0),
        ] {
            if !value.is_finite() || !(lo..=hi).contains(&value) {
                return Err(error(
                    "range",
                    path,
                    "finite parameter outside declared range",
                ));
            }
        }
        Ok(())
    }

    fn controls(&self) -> LiquidObjectControls {
        LiquidObjectControls {
            amount: self.amount,
            frequency: self.frequency,
            speed: self.speed,
            twist: self.twist,
        }
    }
}

pub fn parse_liquid_object_params_json(
    input: &str,
) -> Result<LiquidObjectParams, LiquidObjectError> {
    let params: LiquidObjectParams = serde_json::from_str(input).map_err(|_| {
        error(
            "json",
            "params",
            "strict versioned Liquid Object parameters required",
        )
    })?;
    params.validate()?;
    Ok(params)
}

pub fn resolve_liquid_object_params_json(input: String) -> String {
    match parse_liquid_object_params_json(&input) {
        Ok(params) => serde_json::json!({"version":1,"ok":true,"params":params}).to_string(),
        Err(error) => serde_json::json!({"version":1,"ok":false,"error":error}).to_string(),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FrameRequest {
    version: u8,
    params: LiquidObjectParams,
    time: f64,
    seed: u32,
    positions: Vec<f64>,
    #[serde(default, deserialize_with = "deserialize_domain")]
    domain: Option<LiquidObjectDomain>,
}

fn deserialize_domain<'de, D>(deserializer: D) -> Result<Option<LiquidObjectDomain>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    LiquidObjectDomain::deserialize(deserializer).map(Some)
}

pub fn evaluate_liquid_object_frame_json(input: String) -> String {
    let result = (|| -> Result<LiquidObjectFrame, LiquidObjectError> {
        // Bound text before allocating a potentially unbounded vertex array.
        if input.len() > 12_000_000 {
            return Err(error(
                "budget",
                "request",
                "Liquid Object request exceeds 12MB",
            ));
        }
        let request: FrameRequest = serde_json::from_str(&input)
            .map_err(|_| error("json", "request", "strict frame request required"))?;
        if request.version != 1 {
            return Err(error(
                "version",
                "version",
                "Liquid Object frame requires version 1",
            ));
        }
        request.params.validate()?;
        deform_liquid_object_with_domain(
            &request.positions,
            &request.params.controls(),
            request.time,
            request.seed,
            request.params.enabled,
            request.domain.as_ref(),
        )
        .map_err(|message| error("geometry", "frame", message))
    })();
    match result {
        Ok(frame) => serde_json::json!({"version":1,"ok":true,"frame":frame}).to_string(),
        Err(error) => serde_json::json!({"version":1,"ok":false,"error":error}).to_string(),
    }
}

#[cfg(test)]
#[path = "liquid_object_params_tests.rs"]
mod tests;

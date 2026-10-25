//! Static source crop shared by picture preview, export and native editing admission.
use crate::model::Issue;
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::BTreeMap;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Bounds {
    left: f64,
    top: f64,
    right: f64,
    bottom: f64,
}

impl Bounds {
    fn validate(&self) -> Result<(), Issue> {
        if [self.left, self.top, self.right, self.bottom]
            .iter()
            .any(|v| !v.is_finite() || !(0.0..=1.0).contains(v))
            || self.left >= self.right
            || self.top >= self.bottom
        {
            return Err(Issue::new(
                "editing.params.crop",
                "Crop requires normalized left < right and top < bottom",
            ));
        }
        Ok(())
    }
}

pub(crate) fn validate_crop_params(params: &BTreeMap<String, Value>) -> Result<(), Issue> {
    let read = |key: &str, default: f64| -> Result<f64, Issue> {
        match params.get(key) {
            None => Ok(default),
            Some(value) => value.as_f64().ok_or_else(|| {
                Issue::new(
                    &format!("editing.params.{key}"),
                    "Crop boundary must be numeric",
                )
            }),
        }
    };
    Bounds {
        left: read("crop.left", 0.0)?,
        top: read("crop.top", 0.0)?,
        right: read("crop.right", 1.0)?,
        bottom: read("crop.bottom", 1.0)?,
    }
    .validate()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Input {
    version: u8,
    source_width: f64,
    source_height: f64,
    crop: Bounds,
}

#[bridge::export]
pub fn resolve_media_crop_json(input: String) -> String {
    let result = resolve(&input);
    match result {
        Ok(geometry) => json!({"version":1,"geometry":geometry}),
        Err(error) => json!({"version":1,"error":error}),
    }
    .to_string()
}

fn resolve(input: &str) -> Result<Value, Issue> {
    if input.len() > 4096 {
        return Err(Issue::new("request", "Crop request exceeds budget"));
    }
    let input: Input =
        serde_json::from_str(input).map_err(|_| Issue::new("request", "Invalid crop request"))?;
    if input.version != 1 {
        return Err(Issue::new("version", "Only crop version 1 is supported"));
    }
    if [input.source_width, input.source_height]
        .iter()
        .any(|v| !v.is_finite() || v.fract() != 0.0 || !(1.0..=16384.0).contains(v))
    {
        return Err(Issue::new(
            "source",
            "Crop source dimensions must be integers within 1..16384",
        ));
    }
    input.crop.validate()?;
    let width = (input.crop.right - input.crop.left) * input.source_width;
    let height = (input.crop.bottom - input.crop.top) * input.source_height;
    Ok(json!({
        "sourceX":input.crop.left * input.source_width,
        "sourceY":input.crop.top * input.source_height,
        "sourceWidth":width,"sourceHeight":height,
        "width":width.ceil() as u32,"height":height.ceil() as u32,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crop_geometry_uses_source_boundaries_and_preserves_subpixel_edges() {
        let output = resolve(r#"{"version":1,"sourceWidth":1000,"sourceHeight":500,"crop":{"left":0.125,"top":0.2,"right":0.8,"bottom":0.9}}"#).unwrap();
        assert_eq!(
            output,
            json!({"sourceX":125.0,"sourceY":100.0,"sourceWidth":675.0,"sourceHeight":350.0,"width":675,"height":350})
        );
        let output = resolve(r#"{"version":1,"sourceWidth":3,"sourceHeight":3,"crop":{"left":0.1,"top":0.1,"right":0.9,"bottom":0.9}}"#).unwrap();
        assert_eq!(output["width"], 3);
        assert!((output["sourceWidth"].as_f64().unwrap() - 2.4).abs() < 1e-10);
    }

    #[test]
    fn editing_admission_rejects_invalid_joint_bounds_and_keeps_full_defaults() {
        assert!(validate_crop_params(&BTreeMap::new()).is_ok());
        for values in [
            json!({"crop.left":0.8,"crop.right":0.2}),
            json!({"crop.top":0.5,"crop.bottom":0.5}),
            json!({"crop.left":-0.1}),
            json!({"crop.top":"0.2"}),
        ] {
            let params = serde_json::from_value(values).unwrap();
            assert!(validate_crop_params(&params).is_err());
        }
        let request = json!({
            "editing":{"type":"image","params":{"crop.left":0.8,"crop.right":0.2}},
            "duration":120000,"trackKind":"video","assetKind":"image","hasMotionText":false,"hasAdjustment":false,
            "catalog":{"elements":{"image":[{"key":"crop.left","type":"number","min":0,"max":1},{"key":"crop.right","type":"number","min":0,"max":1}]},"graphics":{},"effects":{},"masks":{}}
        });
        let issues: Value =
            serde_json::from_str(&crate::validate_clip_editing_json(request.to_string())).unwrap();
        assert!(
            issues
                .as_array()
                .unwrap()
                .iter()
                .any(|v| v["path"] == "editing.params.crop")
        );
    }

    #[test]
    fn rejects_bad_dimensions_versions_and_out_of_range_edges() {
        let base = json!({"version":1,"sourceWidth":100,"sourceHeight":100,"crop":{"left":0,"top":0,"right":1,"bottom":1}});
        for (key, value) in [
            ("sourceWidth", json!(0)),
            ("sourceHeight", json!(1.5)),
            ("sourceWidth", json!(16385)),
            ("version", json!(2)),
        ] {
            let mut input = base.clone();
            input[key] = value;
            assert!(resolve(&input.to_string()).is_err());
        }
        let mut input = base;
        input["crop"]["right"] = json!(1.1);
        assert!(resolve(&input.to_string()).is_err());
    }
}

//! Thin native-timeline admission seam. Geometry and ranges remain recipe-owned.
pub use super::transition_model::{Blend, Clip, DrawCommand, Input};
use super::transition_model::{Direction, Transition};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum NativeTransitionDirection {
    Left,
    Right,
    Up,
    Down,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum NativeTransitionStyle {
    Bend {
        direction: NativeTransitionDirection,
        hinge: f64,
        angle: f64,
        perspective: f64,
        shading: f64,
    },
    Peel {
        direction: NativeTransitionDirection,
        curl: f64,
        segments: u32,
        shading: f64,
        perspective: f64,
    },
}
impl NativeTransitionStyle {
    fn recipe_style(&self) -> Transition {
        let recipe_direction = |direction| match direction {
            NativeTransitionDirection::Left => Direction::Left,
            NativeTransitionDirection::Right => Direction::Right,
            NativeTransitionDirection::Up => Direction::Up,
            NativeTransitionDirection::Down => Direction::Down,
        };
        match *self {
            Self::Bend {
                direction: d,
                hinge,
                angle,
                perspective,
                shading,
            } => Transition::Bend {
                direction: recipe_direction(d),
                hinge,
                angle,
                perspective,
                shading,
            },
            Self::Peel {
                direction,
                curl,
                segments,
                shading,
                perspective,
            } => Transition::Peel {
                direction: recipe_direction(direction),
                curl,
                segments,
                shading,
                perspective,
            },
        }
    }
    pub fn valid(&self) -> bool {
        self.recipe_style().valid()
    }
    pub fn work(&self) -> u32 {
        self.recipe_style().work()
    }
    pub fn plan(
        &self,
        progress: f64,
        width: f64,
        height: f64,
    ) -> Result<Vec<DrawCommand>, &'static str> {
        if !self.valid()
            || !progress.is_finite()
            || !(0.0..=1.0).contains(&progress)
            || !width.is_finite()
            || !height.is_finite()
            || width <= 0.0
            || height <= 0.0
        {
            return Err("Invalid native transition style/progress/dimensions");
        }
        Ok(self.recipe_style().plan(progress, width, height, 0))
    }
}

pub fn native_transition_style_validate_json(input: &str) -> Result<String, String> {
    if input.len() > 4096 {
        return Err("Native transition style transport limit exceeded".into());
    }
    let style: NativeTransitionStyle = serde_json::from_str(input).map_err(|e| e.to_string())?;
    if !style.valid() {
        return Err("Native transition style parameters are outside authoritative ranges".into());
    }
    serde_json::to_string(&style).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    const STYLE: &str = r#"{"kind":"peel","direction":"left","curl":0.17,"segments":32,"shading":0.6,"perspective":0.5}"#;
    #[test]
    fn strict_wire_and_existing_authoritative_plan() {
        let validated = native_transition_style_validate_json(STYLE).unwrap();
        let native: NativeTransitionStyle = serde_json::from_str(&validated).unwrap();
        let recipe: Transition = serde_json::from_str(STYLE).unwrap();
        for p in [0.0, 0.2, 0.5, 0.9, 1.0] {
            assert_eq!(
                serde_json::to_value(native.plan(p, 192.0, 128.0).unwrap()).unwrap(),
                serde_json::to_value(recipe.plan(p, 192.0, 128.0, 0)).unwrap()
            );
        }
        for invalid in [
            STYLE.replace("0.17", "0.01"),
            STYLE.replace("32", "65"),
            STYLE.replace("0.6", "1.0"),
            STYLE.replace("0.5", "-1.0"),
            STYLE.replace("left", "diagonal"),
            STYLE.replace("peel", "xfade"),
            STYLE.replace("32", "32.5"),
            STYLE.replace("}", ",\"extra\":1}"),
        ] {
            assert!(native_transition_style_validate_json(&invalid).is_err());
        }
    }

    #[test]
    fn bend_strict_wire_reuses_authoritative_validation_and_plan() {
        for direction in ["left", "right", "up", "down"] {
            let wire = serde_json::json!({"kind":"bend", "direction":direction,
                "hinge":0.5,"angle":std::f64::consts::PI,"perspective":0.5,"shading":0.5});
            let validated = native_transition_style_validate_json(&wire.to_string()).unwrap();
            let native: NativeTransitionStyle = serde_json::from_str(&validated).unwrap();
            let recipe: Transition = serde_json::from_value(wire.clone()).unwrap();
            assert_eq!(native.work(), recipe.work());
            for p in [0.0, 0.2, 0.5, 0.9, 1.0] {
                assert_eq!(
                    serde_json::to_value(native.plan(p, 192.0, 128.0).unwrap()).unwrap(),
                    serde_json::to_value(recipe.plan(p, 192.0, 128.0, 0)).unwrap()
                );
            }
            for (key, invalid) in [
                ("hinge", serde_json::json!(-0.1)),
                ("hinge", serde_json::json!(1.1)),
                ("angle", serde_json::json!(1.0)),
                ("angle", serde_json::json!(4.0)),
                ("perspective", serde_json::json!(0.9)),
                ("shading", serde_json::json!(-0.1)),
                ("shading", serde_json::json!(1.1)),
                ("direction", serde_json::json!("diagonal")),
                ("curl", serde_json::json!(0.17)),
            ] {
                let mut bad = wire.clone();
                bad[key] = invalid;
                assert!(native_transition_style_validate_json(&bad.to_string()).is_err());
            }
            for key in ["direction", "hinge", "angle", "perspective", "shading"] {
                let mut missing = wire.clone();
                missing.as_object_mut().unwrap().remove(key);
                assert!(native_transition_style_validate_json(&missing.to_string()).is_err());
            }
        }
    }
}

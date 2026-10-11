//! Discovery for the stylized recipe extensions. Numeric rules are
//! shared with validation, not re-stated in a UI/Agent schema.
use bridge::export;
use serde::Serialize;
use serde_json::{Value, json};
#[path = "fall_catalog.rs"]
mod fall;
#[path = "flame_catalog.rs"]
mod flame;
#[path = "heart_recipe_catalog.rs"]
mod heart_owner;
#[path = "ink_catalog.rs"]
mod ink;
#[path = "kanji_slam_catalog.rs"]
mod kanji_slam;
#[path = "memories_recipe_catalog.rs"]
mod memories_owner;
#[path = "night_recipe_catalog.rs"]
mod night;
#[path = "road_recipe_catalog.rs"]
mod road;
#[path = "thread_catalog.rs"]
mod thread;
#[path = "tunnel_catalog.rs"]
mod tunnel;

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct NumberRule {
    pub min: f64,
    pub max: f64,
    pub integer: bool,
    pub suggested: f64,
}
impl NumberRule {
    const fn new(min: f64, max: f64, integer: bool, suggested: f64) -> Self {
        Self {
            min,
            max,
            integer,
            suggested,
        }
    }
    pub fn valid(self, value: impl Into<f64>) -> bool {
        let value = value.into();
        value.is_finite()
            && (self.min..=self.max).contains(&value)
            && (!self.integer || value.fract() == 0.0)
    }
}
pub(super) const GLYPH_COLUMNS: NumberRule = NumberRule::new(1.0, 128.0, true, 32.0);
pub(super) const GLYPH_ROWS: NumberRule = NumberRule::new(4.0, 128.0, true, 24.0);
pub(super) const GLYPH_TRAIL: NumberRule = NumberRule::new(1.0, 64.0, true, 12.0);
pub(super) const GLYPH_SPEED: NumberRule = NumberRule::new(0.1, 60.0, false, 7.0);
pub(super) const DRAWING_FPS: NumberRule = NumberRule::new(1.0, 120.0, true, 12.0);
pub(super) const OPACITY: NumberRule = NumberRule::new(0.0, 1.0, false, 1.0);
pub(super) const PARTICLE_GRID: NumberRule = NumberRule::new(1.0, 64.0, true, 16.0);
pub(super) const RECT_ORIGIN: NumberRule = NumberRule::new(-1.0, 1.0, false, 0.0);
pub(super) const RECT_SIZE: NumberRule = NumberRule::new(0.01, 2.0, false, 1.0);
pub(super) const SCATTER: NumberRule = NumberRule::new(0.0, 2.0, false, 0.8);
pub(super) const STAGGER: NumberRule = NumberRule::new(0.0, 0.9, false, 0.4);
pub(super) const SPIN: NumberRule = NumberRule::new(-4.0, 4.0, false, 1.0);
pub(super) const START_SCALE: NumberRule = NumberRule::new(0.0, 1.0, false, 0.1);
pub(super) const PEEL_CURL: NumberRule = NumberRule::new(0.05, 0.4, false, 0.17);
pub(super) const PEEL_SEGMENTS: NumberRule = NumberRule::new(8.0, 64.0, true, 32.0);
pub(super) const PEEL_SHADING: NumberRule = NumberRule::new(0.0, 0.8, false, 0.6);
pub(super) const PEEL_PERSPECTIVE: NumberRule = NumberRule::new(0.0, 0.8, false, 0.5);
pub(super) const MAX_GLYPHS: usize = 64;
pub(super) const GENERATOR_PRIMITIVES: u32 = 4096;

fn number(rule: NumberRule, unit: &str) -> Value {
    let mut value = serde_json::to_value(rule).expect("finite static rule");
    if rule.integer {
        value["min"] = json!(rule.min as i64);
        value["max"] = json!(rule.max as i64);
        value["suggested"] = json!(rule.suggested as i64);
    }
    value["type"] = json!("number");
    value["unit"] = json!(unit);
    value
}
fn color(suggested: [f64; 4]) -> Value {
    json!({"type":"rgba", "min":0, "max":1, "length":4, "suggested":suggested})
}

#[export]
pub fn mv_recipe_catalog_json() -> String {
    use super::{generator_model, transition_model};
    // This describes authoring support in this binary, never health or an
    // installation's verification status. Suggestions are NOT implicit defaults.
    let mut native_owner_scenes = heart_owner::entries();
    native_owner_scenes["memories"] = memories_owner::entry();
    native_owner_scenes["night"] = night::entry();
    let generators = json!({
            "flame":flame::entry(),
            "ink":ink::entry(),
            "road":road::entry(),
            "fall":fall::entry(),
            "thread":thread::entry(),
            "tunnel":tunnel::entry(),
            "kanjiSlam":kanji_slam::entry(),
            "titleRiff":super::title_riff::catalog_entry(),
            "ember":super::ember::catalog_entry(),
            "converge":super::converge::catalog_entry(),
            "typeCard":super::type_card::catalog_entry(),
            "afterimage":super::afterimage::catalog_entry(),
            "cloth":super::cloth::catalog_entry(),
            "shatter":super::shatter::catalog_entry(),
            "grid":super::grid::catalog_entry(),
            "hexFloat":super::hex_float::catalog_entry(),
            "asciiSweep":super::ascii_sweep::catalog_entry(),
            "particleScroll":super::particle_scroll::catalog_entry(),
            "glyphRain":{
                "requires":["canvas-worker-2d", "declared-font-resource"],
                "binding":"scene.settings; scene.role selects output role",
                "clock":"songStartSeconds + source-frame time; drawingFps quantization; ref remaps source time",
                "parameters":{
                    "font":{"type":"resource", "kind":"font"},
                    "glyphs":{"type":"text", "minLength":1, "maxLength":MAX_GLYPHS,
                        "lengthUnit":"unicode-scalars", "controlCharacters":false, "suggested":"01ABC+-"},
                    "columns":number(GLYPH_COLUMNS,"cells"),
                    "rows":number(GLYPH_ROWS,"cells"),
                    "trail":number(GLYPH_TRAIL,"cells"),
                    "speed":number(GLYPH_SPEED,"cells/second"),
                    "drawingFps":number(DRAWING_FPS,"samples/second"),
                    "opacity":number(OPACITY,"ratio"),
                    "color":color([0.0,1.0,0.4,1.0]),
                    "headColor":color([1.0,1.0,1.0,1.0])
                },
                "constraints":["trail <= rows", "columns * trail charged to expanded primitive budget"],
                "limitations":["author must ensure font glyph coverage", "individual Unicode scalars, not shaped text", "generator, not input filter"]
            },
            "particleReveal":{
                "requires":["canvas-worker-2d", "declared-image-resource"],
                "binding":"scene.settings plus scene.role, scene.span and scene.easing",
                "clock":"explicit source-frame span -> eased progress; ref remaps source time",
                "parameters":{
                    "image":{"type":"resource", "kind":"image"},
                    "columns":number(PARTICLE_GRID,"cells"),
                    "rows":number(PARTICLE_GRID,"cells"),
                    "rect":{"type":"tuple", "items":[number(RECT_ORIGIN,"frame-width"),number(RECT_ORIGIN,"frame-height"),number(RECT_SIZE,"frame-width"),number(RECT_SIZE,"frame-height")]},
                    "fit":{"type":"enum", "options":[generator_model::Fit::Contain,generator_model::Fit::Cover,generator_model::Fit::Stretch], "suggested":"contain"},
                    "scatter":number(SCATTER,"frame-size"),
                    "stagger":number(STAGGER,"progress"),
                    "spin":number(SPIN,"turns"),
                    "startScale":number(START_SCALE,"ratio"),
                    "opacity":number(OPACITY,"ratio"),
                    "direction":{"type":"enum", "options":[generator_model::Direction::In,generator_model::Direction::Out], "suggested":"in"}
                },
                "constraints":["columns * rows charged to expanded primitive budget"],
                "limitations":["analytical textured cells, not a physics simulation", "one declared image, not arbitrary lower compositor content"]
            }
    });
    json!({
        "version":1,
        "scope":"stylized-recipe-extensions",
        "availability":"implemented-not-runtime-probed",
        "parameterSemantics":"all-listed-fields-required unless explicitly marked required:false; suggestions-not-defaults; replace-recipe",
        "seed":"source.seed; deterministic source-time sampling or bounded fixed-step replay; no wall-clock accumulation",
        "finishing":super::post_catalog::finishing(),
        "postStages":{
            "supported":["role","composite"],
            "default":"role",
            "order":"all role post, canonical output-role composition, all composite post; preserve order within each stage",
            "targets":"role requires 1..4 unique roles; composite requires omitted or empty roles",
            "scope":"selected recipe.outputRoles only; not external timeline/native lyric pixels",
            "passBudget":128,
            "passCost":"ordinary effect 1; bloom 10; lightLeak preserve 3/expand 2; role stage multiplies by target roles, composite counts once"
        },
        "generatorPrimitiveBudget": GENERATOR_PRIMITIVES,
        "simulationWorkBudget": super::cloth::MAX_SIMULATION_WORK,
        "budgetScope":"expanded-recipe-DAG-including-repeated-inputs; existing-operation-and-raster-caps-also-apply",
        "generators":generators,
        "referenceScenes":{"burst":super::burst::catalog_entry(),"illustNative":super::illust_native::catalog_entry(),
            "freeze":super::meta_reference::Freeze::catalog_entry(),"rewind":super::meta_reference::Rewind::catalog_entry(),
            "melt":super::meta_reference::Melt::catalog_entry(),"panelsNative":super::meta_reference::Panels::catalog_entry(),
            "jz":super::jz::catalog_entry(),"layers":super::layers::catalog_entry()},
        "nativeOwnerScenes":native_owner_scenes,
        "transitionParameters":{
            "bend":super::transition_bend::catalog_entry(),
            "peel":{
                "requires":["worker-webgl2"],
                "binding":"scene.style plus scene.from, scene.to, scene.span and scene.easing",
                "clock":"explicit source-frame span -> eased progress; exact A/B endpoints",
                "parameters":{
                    "direction":{"type":"enum", "options":[transition_model::Direction::Left,transition_model::Direction::Right,transition_model::Direction::Up,transition_model::Direction::Down], "suggested":"left"},
                    "curl":number(PEEL_CURL,"fold-axis-length"),
                    "segments":number(PEEL_SEGMENTS,"strips"),
                    "shading":number(PEEL_SHADING,"ratio"),
                    "perspective":number(PEEL_PERSPECTIVE,"ratio")
                },
                "constraints":["2 + segments * 2 charged to operation budget", "four extra surfaces charged to raster budget"],
                "limitations":["recipe A/B scenes only, not adjacent timeline clips", "explicit error when Worker WebGL2 is unavailable"]
            }
        }
    }).to_string()
}

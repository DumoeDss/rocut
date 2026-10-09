use super::*;
use serde_json::{Value, json};

fn number(rule: NumberRule, unit: &str) -> Value {
    let mut value = serde_json::to_value(rule).expect("finite Cloth rule");
    if rule.integer {
        value["min"] = json!(rule.min as u64);
        value["max"] = json!(rule.max as u64);
        value["suggested"] = json!(rule.suggested as u64);
    }
    value["type"] = json!("number");
    value["unit"] = json!(unit);
    value
}

fn tuple(rule: NumberRule, units: &[&str], suggested: Option<Value>) -> Value {
    let mut value =
        json!({"type":"tuple", "items":units.iter().map(|u| number(rule,u)).collect::<Vec<_>>()});
    if let Some(suggested) = suggested {
        if let Some(items) = suggested.as_array() {
            for (index, item) in items.iter().enumerate() {
                value["items"][index]["suggested"] = item.clone();
            }
        }
        value["suggested"] = suggested;
    }
    value
}

pub(in crate::mv_recipe) fn catalog_entry() -> Value {
    json!({
        "requires":["worker-webgl2","declared-image-resource"],
        "binding":"scene.settings plus scene.role and scene.span; no easing",
        "clock":"explicit source-frame span -> elapsed source ticks; 120Hz fixed XPBD steps (1000 ticks); floor-step remainder; ref remaps source time; freezes after span; songStart does not advance physics",
        "parameters":{
            "image":{"type":"resource","kind":"image"},
            "rect":{"type":"tuple","items":[number(RECT_ORIGIN,"frame-width"),number(RECT_ORIGIN,"frame-height"),number(RECT_SIZE,"frame-width"),number(RECT_SIZE,"frame-height")]},
            "fit":{"type":"enum","options":[Fit::Contain,Fit::Cover,Fit::Stretch],"suggested":"contain"},
            "columns":number(CELLS,"cells"),
            "rows":number(NumberRule { suggested:8.0,..CELLS },"cells"),
            "pins":{"type":"enum","options":["topEdge","topCorners","leftEdge"],"suggested":"topEdge"},
            "gravity":number(GRAVITY,"rect-short-side/second^2"),
            "wind":tuple(WIND,&["rect-short-side/second^2";3],Some(json!([0.3,0,0.8]))),
            "gust":number(GUST,"rect-short-side/second^2"),
            "gustFrequency":number(FREQUENCY,"Hz"),
            "damping":number(DAMPING,"1/second"),
            "stretchCompliance":number(STRETCH,"normalized-XPBD-compliance"),
            "bendCompliance":number(BEND,"normalized-XPBD-compliance"),
            "solverIterations":number(ITERATIONS,"iterations/step"),
            "perspective":number(PERSPECTIVE,"ratio"),
            "shading":number(SHADING,"ratio"),"opacity":number(OPACITY,"ratio"),
            "events":{"type":"array","minItems":0,"maxItems":16,"suggested":[],"items":{
                "type":"object","additionalProperties":false,
                "required":["atTicks","center","radius","velocity"],
                "properties":{
                    "atTicks":number(EVENT_TICKS,"source-ticks-after-span-start"),
                    "center":tuple(CENTER,&["rest-u","rest-v"],None),
                    "radius":number(RADIUS,"rect-short-side"),
                    "velocity":tuple(VELOCITY,&["rect-short-side/second";3],None)
                }
            }}
        },
        "constraints":[
            "every listed parameter and every event field is required",
            "events are nondecreasing by atTicks; each is strictly before span duration",
            "0 < span duration <= 3600000 ticks (30 seconds), at most 3600 fixed steps",
            "4 * columns * rows conservative raster triangles per expanded occurrence; whole DAG maximum 4096 primitives",
            "whole expanded recipe DAG simulation work <= 80000000; request-local replay memory <= 8 MiB",
            "work charges all source-age steps even when checkpointed; no global mutable cache"
        ],
        "endpoints":"elapsed=0 uses the complete fitted image; all positive elapsed times use mesh, including the zero-step remainder; final state freezes without automatic return",
        "geometry":"(columns+1)*(rows+1) initially flat stationary vertices; structural, two-diagonal shear and two-edge distance-bending XPBD constraints; pins have zero inverse mass and stay exactly at rest",
        "solver":"short-side-normalized coordinates; unit free-particle inverse mass; alpha=compliance/dt^2; lambda reset each step and accumulated across solver iterations; semi-implicit velocity integration; velocity=(velocity+acceleration*dt)*exp(-damping*dt)",
        "events":"velocity impulse centered in rest UV; radial distance measured in rest-space rect-short-side units; smoothstep falloff; step [startTicks,endTicks), in authored order; pins ignore impulses",
        "gust":"seed controls forcing phase only; acceleration sampled at fixed step start; initial positions and velocities are seed-independent",
        "projection":"camera=8*rect long side, centered on authored rect; positive z approaches camera; triangles clipped against w>=0.05 before projection, without clamping physical positions",
        "shading":"1-shading*(1-abs(faceNormal.z)); stable far-to-near ordering; no backface culling; original source alpha",
        "opacity":"fullImage uses plan opacity; each face carries final opacity, without a second plan multiplication",
        "replayIdentity":"all settings including events, seed, image id and SHA-256, output dimensions and step rule",
        "workUnits":"C=structural+shear+two-edge-bend constraints; V=(columns+1)*(rows+1); E=event count; init=4V+3C+2E+24576; step=C*(solverIterations+2)+V*(8+E)+2E+32",
        "limitations":["one declared image, not lower compositor content or another scene","distance-bending approximation, not a dihedral cloth model","no self-collision, object collisions, tearing or material thickness","off-frame source UVs are transparent"]
    })
}

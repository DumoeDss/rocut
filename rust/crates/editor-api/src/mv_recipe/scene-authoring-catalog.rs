//! Structural authoring only. Recipe Apply remains the graph and clock authority.
use super::super::{layers, model::Role, reference};
use serde_json::{Value, json};

fn input() -> Value {
    json!({"type":"string","minLength":1,"description":"Existing recipe node id; Rust Apply validates references and cycles"})
}

fn frame(min: u32) -> Value {
    json!({"type":"number","integer":true,"min":min,"max":u32::MAX,
        "description":"Integer frame; recipe frame limit is validated by Rust Apply"})
}

fn span() -> Value {
    json!({"type":"object","required":["startFrame","durationFrames"],"additionalProperties":false,
        "properties":{"startFrame":frame(0),"durationFrames":frame(1)}})
}

fn time_map() -> Value {
    json!({"type":"array","minItems":1,"maxItems":reference::MAX_TIME_POINTS,
        "items":{"type":"object","required":["atFrame","sourceFrame"],"additionalProperties":false,
            "properties":{"atFrame":frame(0),"sourceFrame":frame(0)}},
        "description":"Explicit knots in author order; Rust Apply validates strictly increasing atFrame and frame bounds. Repeated or descending sourceFrame freezes or rewinds."})
}

pub(super) fn entries() -> Value {
    json!({
        "layers":{
            "parameters":{"items":{"type":"array","minItems":1,"maxItems":layers::MAX_ITEMS,
                "items":{"type":"object","required":["input","roles"],"additionalProperties":false,
                    "properties":{"input":input(),"roles":{"type":"array","minItems":1,"maxItems":4,
                        "items":{"type":"enum","options":[Role::Background,Role::Subject,Role::Graphics,Role::Foreground]}}}}}},
            "constraints":["Rust Apply validates node references, cycles, unique roles and expanded graph budgets; UI must not infer roles or evaluate the graph"]
        },
        "sequence":{
            "parameters":{"items":{"type":"array","minItems":1,"maxItems":reference::MAX_SEQUENCE_ITEMS,
                "items":{"type":"object","required":["input","span","timeMap"],"additionalProperties":false,
                    "properties":{"input":input(),"span":span(),"timeMap":time_map()}}}},
            "constraints":["Rust Apply validates node references, ordered non-overlapping spans, strictly increasing timeMap knots, frame limits and expanded graph budgets; UI must preserve author order"]
        },
        "ref":{
            "parameters":{"input":input(),"timeMap":time_map()},
            "constraints":["Rust Apply validates node references, cycles, strictly increasing timeMap knots and recipe frame limits; UI must not sort knots or infer a clock"]
        }
    })
}

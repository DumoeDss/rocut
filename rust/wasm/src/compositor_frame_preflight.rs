//! Check the recursive JS wire shape before serde visits it. Rust compositor
//! admission remains authoritative for opacity, dimensions, effects and targets.
//! Flat legacy frames keep their old item-count semantics; grouped frames and
//! scene transitions gain expanded-tree limits. No GPU/resource work happens here.
use compositor::{MAX_GROUP_DEPTH, MAX_GROUP_EFFECT_PASSES, MAX_GROUP_FRAME_ITEMS, MAX_GROUPS};
use js_sys::{Object, Reflect};
use wasm_bindgen::JsValue;

type Result<T> = std::result::Result<T, &'static str>;

#[path = "compositor_frame_transport.rs"]
mod transport;

#[wasm_bindgen::prelude::wasm_bindgen]
extern "C" {
    // Unlike js_sys::Array::is_array, catch a revoked Proxy's TypeError too.
    #[wasm_bindgen(catch, js_namespace = Array, js_name = isArray)]
    fn checked_array(value: &JsValue) -> std::result::Result<bool, JsValue>;
}

fn is_array(value: &JsValue) -> Result<bool> {
    checked_array(value).map_err(|_| "group preflight could not inspect an array")
}

#[derive(Default)]
struct Effects {
    groups: usize,
    passes: usize,
}
impl Effects {
    fn visit(&mut self, value: &JsValue) -> Result<()> {
        let groups = property(value, "effectPassGroups")?;
        // Layer defaults remain serde's responsibility; missing required group
        // or sceneEffect fields are still rejected by that same deserializer.
        if groups.is_undefined() {
            return Ok(());
        }
        let length = array_length(&groups)?;
        self.groups = self.groups.saturating_add(length as usize);
        if self.groups > MAX_GROUP_EFFECT_PASSES {
            return Err("group preflight effect pass-group limit exceeded");
        }
        for index in 0..length {
            self.passes = self
                .passes
                .saturating_add(array_length(&item(&groups, index)?)? as usize);
            if self.passes > MAX_GROUP_EFFECT_PASSES {
                return Err("group preflight effect pass limit exceeded");
            }
        }
        Ok(())
    }
}

struct Cursor {
    owner: JsValue,
    children: Children,
    depth: usize,
}

enum Children {
    Items {
        items: JsValue,
        length: u32,
        next: u32,
    },
    // Branches are untagged group descriptors, not arrays or frame-item enums.
    // Keep the transition on the ancestor path until both branches finish.
    Branches {
        next: usize,
    },
}

impl Cursor {
    fn next(&mut self) -> Result<Option<(JsValue, bool)>> {
        match &mut self.children {
            Children::Items {
                items,
                length,
                next,
            } => {
                if *next == *length {
                    return Ok(None);
                }
                let value = item(items, *next)?;
                *next += 1;
                Ok(Some((value, false)))
            }
            Children::Branches { next } => {
                let Some(side) = ["outgoing", "incoming"].get(*next) else {
                    return Ok(None);
                };
                let value = property(&self.owner, side)?;
                *next += 1;
                Ok(Some((value, true)))
            }
        }
    }
}

fn property(value: &JsValue, key: &str) -> Result<JsValue> {
    Reflect::get(value, &JsValue::from_str(key))
        .map_err(|_| "group preflight could not read a structural property")
}

fn array_length(value: &JsValue) -> Result<u32> {
    if !is_array(value)? {
        return Err("group preflight requires frame item arrays");
    }
    let length = property(value, "length")?
        .as_f64()
        .filter(|n| n.is_finite() && n.fract() == 0.0 && (0.0..=u32::MAX as f64).contains(n))
        .ok_or("group preflight requires a valid array length")?;
    Ok(length as u32)
}

fn item(items: &JsValue, index: u32) -> Result<JsValue> {
    Reflect::get(items, &JsValue::from_f64(f64::from(index)))
        .map_err(|_| "group preflight could not read a frame item")
}

fn kind(item: &JsValue) -> Result<&'static str> {
    let value = property(item, "type")?;
    // Do not copy an arbitrarily long caller-owned discriminator into Rust.
    for kind in [
        "group",
        "layer",
        "transition",
        "sceneEffect",
        "sceneTransition",
    ] {
        if value == JsValue::from_str(kind) {
            return Ok(kind);
        }
    }
    Err("group preflight encountered an unknown frame item type")
}

pub(super) fn validate(frame: &JsValue) -> Result<()> {
    let root_items = property(frame, "items")?;
    let root_length = array_length(&root_items)?;
    // This shallow scan is deliberately linear, not capped at 4096: applying
    // that new limit to historical flat frames would change their admission.
    // It never visits any children or copies an entire caller-owned array.
    let mut grouped = false;
    for index in 0..root_length {
        if matches!(
            kind(&item(&root_items, index)?)?,
            "group" | "sceneTransition"
        ) {
            grouped = true;
            break;
        }
    }
    if !grouped {
        return Ok(());
    }
    if root_length as usize > MAX_GROUP_FRAME_ITEMS {
        return Err("group preflight expanded frame item limit exceeded");
    }
    let mut pending = vec![Cursor {
        owner: frame.clone(),
        children: Children::Items {
            items: root_items,
            length: root_length,
            next: 0,
        },
        depth: 0,
    }];
    let (mut groups, mut expanded) = (0usize, 0usize);
    let mut effects = Effects::default();
    while let Some(cursor) = pending.last_mut() {
        let Some((value, is_branch)) = cursor.next()? else {
            pending.pop();
            continue;
        };
        let depth = cursor.depth;
        expanded = expanded.saturating_add(1);
        if expanded > MAX_GROUP_FRAME_ITEMS {
            return Err("group preflight expanded frame item limit exceeded");
        }
        match if is_branch { "group" } else { kind(&value)? } {
            "group" => {
                effects.visit(&value)?;
                if pending
                    .iter()
                    .any(|ancestor| Object::is(&ancestor.owner, &value))
                {
                    return Err("group preflight ancestor cycle detected");
                }
                groups += 1;
                let child_depth = depth + 1;
                if child_depth > MAX_GROUP_DEPTH || groups > MAX_GROUPS {
                    return Err("group preflight group depth or count limit exceeded");
                }
                let children = property(&value, "items")?;
                let length = array_length(&children)?;
                if length as usize > MAX_GROUP_FRAME_ITEMS.saturating_sub(expanded) {
                    return Err("group preflight expanded frame item limit exceeded");
                }
                // Each occurrence is expanded, including opacity-zero groups.
                // Sibling aliases are not cycles: only the live ancestor path
                // participates in identity checks, and popping removes it.
                pending.push(Cursor {
                    owner: value,
                    children: Children::Items {
                        items: children,
                        length,
                        next: 0,
                    },
                    depth: child_depth,
                });
            }
            "sceneTransition" => {
                if pending
                    .iter()
                    .any(|ancestor| Object::is(&ancestor.owner, &value))
                {
                    return Err("group preflight ancestor cycle detected");
                }
                // Both branches are expanded, even at progress 0 or 1. Each
                // contributes one item, one group and one depth level; siblings
                // may alias but never share an admission/preparation shortcut.
                pending.push(Cursor {
                    owner: value,
                    children: Children::Branches { next: 0 },
                    depth,
                });
            }
            "transition" => {
                for side in ["outgoing", "incoming"] {
                    let layers = property(&value, side)?;
                    let length = array_length(&layers)?;
                    expanded = expanded.saturating_add(length as usize);
                    if expanded > MAX_GROUP_FRAME_ITEMS {
                        return Err("group preflight expanded frame item limit exceeded");
                    }
                    for index in 0..length {
                        effects.visit(&item(&layers, index)?)?;
                    }
                }
            }
            _ => effects.visit(&value)?,
        }
    }
    transport::validate(frame)
}

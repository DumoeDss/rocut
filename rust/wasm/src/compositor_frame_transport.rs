//! Conservative pre-serde transport envelope, not a JS heap/RSS measurement.
//! Count every expanded occurrence (including aliases) before Rust copies large
//! strings, vectors or maps. Flat historical frames never enter this helper.
use compositor::{MAX_GROUP_DEPTH, MAX_GROUP_TRANSPORT_BYTES};
use js_sys::{Array, JsString, Object, Reflect};
use wasm_bindgen::{JsCast, JsValue};

use super::{Result, array_length, is_array, property};

struct Cursor {
    owner: JsValue,
    keys: Option<Array>,
    length: u32,
    next: u32,
}

fn reserve(bytes: &mut u64, amount: u64) -> Result<()> {
    *bytes = bytes.saturating_add(amount);
    if *bytes > MAX_GROUP_TRANSPORT_BYTES {
        return Err("group preflight transport memory limit exceeded");
    }
    Ok(())
}

fn string(bytes: &mut u64, value: &JsValue) -> Result<()> {
    // Inspect JS UTF-16 length before allocating a Rust String. Three bytes per
    // code unit conservatively cover UTF-8, including surrogate pairs.
    reserve(
        bytes,
        16 + 3 * u64::from(JsString::from(value.clone()).length()),
    )
}

fn own_data(value: &JsValue, key: &JsValue) -> Result<JsValue> {
    let descriptor = Reflect::get_own_property_descriptor(value.unchecked_ref::<Object>(), key)
        .map_err(|_| "group preflight could not inspect a transport property")?;
    if descriptor.is_undefined()
        || !Reflect::has(&descriptor, &JsValue::from_str("value"))
            .map_err(|_| "group preflight could not inspect a data property")?
    {
        // Avoid invoking accessor code again inside serde after a checked read.
        // Grouped wire data is a data tree, not executable getters/array holes.
        return Err("group preflight requires own data properties");
    }
    property(&descriptor, "value")
}

pub(super) fn validate(frame: &JsValue) -> Result<()> {
    let mut bytes = 8192;
    let mut pending: Vec<Cursor> = Vec::new();
    let mut current = Some((frame.clone(), false));
    loop {
        if let Some((value, uniform_map)) = current.take() {
            if value.is_string() {
                string(&mut bytes, &value)?;
            } else if value.is_null()
                || value.is_undefined()
                || value.as_f64().is_some()
                || value.as_bool().is_some()
            {
                reserve(&mut bytes, 8)?;
            } else if value.is_object() {
                if pending
                    .iter()
                    .any(|ancestor| Object::is(&ancestor.owner, &value))
                {
                    return Err("group preflight transport ancestor cycle detected");
                }
                // Every group adds an object and an items array, and a scene
                // transition may add one record before its branch group. The
                // extra sixteen cover fixed frame/pass/uniform schema nesting.
                // Deep unknown metadata must not recurse inside serde.
                if pending.len() >= MAX_GROUP_DEPTH * 3 + 16 {
                    return Err("group preflight transport nesting limit exceeded");
                }
                let (keys, length, slots, container) = if is_array(&value)? {
                    if uniform_map {
                        return Err("group preflight requires plain uniform maps");
                    }
                    (None, array_length(&value)?, 8, 64)
                } else {
                    let prototype = Reflect::get_prototype_of(&value)
                        .map_err(|_| "group preflight could not inspect a map prototype")?;
                    if !prototype.is_null()
                        && !Reflect::get_prototype_of(&prototype)
                            .map_err(|_| "group preflight could not inspect a map prototype")?
                            .is_null()
                    {
                        // serde accepts some JS iterable collections as well.
                        // Their payload is invisible to ownKeys, so they cannot
                        // bypass this JSON-like grouped wire envelope.
                        return Err("group preflight requires plain object maps");
                    }
                    // JS ownKeys materializes its native key list, but no map
                    // entries/strings are copied into Rust before this budget.
                    let keys = Reflect::own_keys(&value)
                        .map_err(|_| "group preflight could not enumerate transport keys")?;
                    let length = keys.length();
                    // Frame/pass records have fixed fields. Uniform dictionaries
                    // additionally reserve hash-table entries, spare capacity and
                    // key/value storage on both 32- and 64-bit Rust targets.
                    (Some(keys), length, if uniform_map { 256 } else { 32 }, 128)
                };
                reserve(&mut bytes, container + u64::from(length) * slots)?;
                pending.push(Cursor {
                    owner: value,
                    keys,
                    length,
                    next: 0,
                });
            } else {
                return Err("group preflight requires plain transport values");
            }
        }
        let Some(cursor) = pending.last_mut() else {
            return Ok(());
        };
        if cursor.next == cursor.length {
            pending.pop();
            continue;
        }
        let key = match &cursor.keys {
            Some(keys) => {
                let key = keys.get(cursor.next);
                if !key.is_string() {
                    return Err("group preflight requires string map keys");
                }
                string(&mut bytes, &key)?;
                key
            }
            None => JsValue::from_f64(f64::from(cursor.next)),
        };
        cursor.next += 1;
        current = Some((
            own_data(&cursor.owner, &key)?,
            key == JsValue::from_str("uniforms"),
        ));
    }
}

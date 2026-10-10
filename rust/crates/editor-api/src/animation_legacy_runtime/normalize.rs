use super::{error, object, required};
use crate::animation_boundary as boundary;
use serde_json::{Value, json};
use std::collections::BTreeSet;
const MAX_TICKS: u64 = 9_007_199_254_740_991;

pub(super) fn item(value: &Value, path: &str) -> Result<Value, Value> {
    let fields = object(value, path, &["id", "channel", "fallbackValue", "times"])?;
    let fallback = required(fields, "fallbackValue", path)?;
    let times = required(fields, "times", path)?;
    let channel = fields.get("channel").cloned().unwrap_or_else(|| json!({"keys":[]}));
    Ok(json!({"id":value["id"],"channel":normalize(&channel,&format!("{path}/channel"))?,"fallbackValue":fallback,"times":times}))
}

fn normalize(value: &Value, path: &str) -> Result<Value, Value> {
    let fields = object(value, path, &["keys", "extrapolation"])?;
    let source = required(fields, "keys", path)?.as_array().ok_or_else(|| error("invalid-array", path, "Expected keys array"))?;
    if source.len() > boundary::MAX_ITEM_KEYS { return Err(error("item-key-count", path, "Item exceeds 8192 keys")); }
    let mut ids = BTreeSet::new();
    let mut keys = Vec::with_capacity(source.len());
    for (index, key) in source.iter().enumerate() {
        let key_path = format!("{path}/keys/{index}");
        let result = normalize_key(key, &key_path, &mut ids);
        keys.push(result.map_err(|mut error| { error["keyIndex"] = json!(index); error })?);
    }
    keys.sort_by_key(|key| key["time"].as_u64().expect("validated time"));
    for index in 0..keys.len() {
        if index > 0 && keys[index-1]["time"] == keys[index]["time"] {
            return Err(error("duplicate-key-time", path, "Sorted key times must be strictly increasing"));
        }
        let time = keys[index]["time"].as_u64().expect("validated time");
        let left_span = (index > 0).then(|| time - keys[index-1]["time"].as_u64().expect("validated time"));
        let right_span = keys.get(index+1).map(|key| key["time"].as_u64().expect("validated time")-time);
        for (name, span, left) in [("leftHandle",left_span,true),("rightHandle",right_span,false)] {
            if let Some(span) = span {
                if let Some(handle) = keys[index].get_mut(name) {
                    let dt = handle["dt"].as_i64().expect("validated handle");
                    handle["dt"] = json!(if left { dt.clamp(-(span as i64),0) } else { dt.clamp(0,span as i64) });
                }
            } else { keys[index].as_object_mut().expect("key").remove(name); }
        }
    }
    let edges = match fields.get("extrapolation") {
        None => json!({"before":"hold","after":"hold"}),
        Some(value) => {
            let edge_path = format!("{path}/extrapolation");
            let fields = object(value, &edge_path, &["before","after"])?;
            for side in ["before","after"] {
                if !matches!(required(fields,side,&edge_path)?.as_str(),Some("hold"|"linear")) {
                    return Err(error("invalid-extrapolation", &edge_path, "Expected hold or linear"));
                }
            }
            value.clone()
        }
    };
    Ok(json!({"keys":keys,"extrapolation":edges}))
}

fn normalize_key(value: &Value, path: &str, ids: &mut BTreeSet<String>) -> Result<Value, Value> {
    let fields = object(value,path,&["id","time","value","segmentToNext","tangentMode","leftHandle","rightHandle"])?;
    if let Some(id) = fields.get("id") {
        let id = id.as_str().filter(|id| !id.is_empty()).ok_or_else(|| error("invalid-key-id",path,"Expected nonempty key ID"))?;
        if !ids.insert(id.to_owned()) { return Err(error("duplicate-key-id",path,"Key IDs must be unique")); }
    }
    if fields.get("tangentMode").is_some_and(|value| !matches!(value.as_str(),Some("auto"|"aligned"|"broken"|"flat"))) {
        return Err(error("invalid-tangent-mode",path,"Unknown legacy tangent mode"));
    }
    let time = required(fields,"time",path)?.as_u64().filter(|time| *time<=MAX_TICKS)
        .ok_or_else(|| error("invalid-key-time",path,"Expected nonnegative safe integer JSON token"))?;
    let value = required(fields,"value",path)?.as_f64().filter(|value| value.is_finite())
        .ok_or_else(|| error("non-finite-input",path,"Expected finite scalar value"))?;
    let segment = fields.get("segmentToNext").map_or(Some("linear"),Value::as_str);
    if !matches!(segment,Some("linear"|"step"|"bezier")) { return Err(error("invalid-segment",path,"Expected linear, step or bezier")); }
    let mut key = json!({"time":time,"value":value,"segmentToNext":segment});
    for side in ["leftHandle","rightHandle"] {
        if let Some(handle) = fields.get(side) {
            let handle_path = format!("{path}/{side}");
            let fields = object(handle,&handle_path,&["dt","dv"])?;
            let dt = required(fields,"dt",&handle_path)?.as_i64().filter(|dt|dt.unsigned_abs()<=MAX_TICKS)
                .ok_or_else(|| error("invalid-handle",&handle_path,"Expected signed safe integer JSON token"))?;
            let dv = required(fields,"dv",&handle_path)?.as_f64().filter(|dv|dv.is_finite())
                .ok_or_else(|| error("non-finite-input",&handle_path,"Expected finite handle dv"))?;
            key[side] = json!({"dt":dt,"dv":dv});
        }
    }
    Ok(key)
}

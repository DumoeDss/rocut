use super::{
    MAX_ITEMS, MAX_REQUEST_KEYS, MAX_REQUEST_NODES, MAX_REQUEST_SAMPLES, MAX_STRING_BYTES,
    NUMERIC_SEMANTICS, VERSION, model::*, read,
};
use serde_json::Value;
use std::collections::BTreeSet;

pub(super) fn prepare(mut value: Value, inspection: bool) -> Result<Request, Error> {
    let allowed: &[&str] = if inspection {
        &["version", "numericSemantics", "items", "budget"]
    } else {
        &["version", "numericSemantics", "items"]
    };
    let fields = read::object(&value, "$", allowed)?;
    if read::required(fields, "version", "$")?.as_u64() != Some(u64::from(VERSION)) {
        return Err(Error::new(
            "unsupported-version",
            "$/version",
            "Only version 1 is supported",
        ));
    }
    if read::required(fields, "numericSemantics", "$")?.as_str() != Some(NUMERIC_SEMANTICS) {
        return Err(Error::new(
            "unsupported-semantics",
            "$/numericSemantics",
            "Expected scalar-f64-v1 numeric semantics",
        ));
    }
    let max_nodes = if inspection {
        read::budget(
            read::required(fields, "budget", "$")?,
            "$/budget",
            MAX_REQUEST_NODES,
        )?
    } else {
        0
    };
    let items = read::array(read::required(fields, "items", "$")?, "$/items")?;
    if items.len() > MAX_ITEMS {
        return Err(Error::new(
            "item-count",
            "$/items",
            "Request exceeds 128 items",
        ));
    }
    let mut ids = BTreeSet::new();
    let mut total_keys = 0usize;
    let mut total_samples = 0usize;
    for (index, item) in items.iter().enumerate() {
        let location = format!("$/items/{index}/id");
        let id = item
            .get("id")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty() && id.len() <= MAX_STRING_BYTES)
            .ok_or_else(|| {
                Error::new(
                    "invalid-id",
                    &location,
                    "Every item needs a nonempty ID of at most 256 UTF-8 bytes",
                )
            })?;
        if !ids.insert(id) {
            return Err(Error::new(
                "duplicate-id",
                location,
                "Item IDs must be unique within a request",
            ));
        }
        total_keys += item
            .get("channel")
            .and_then(|channel| channel.get("keys"))
            .and_then(Value::as_array)
            .map_or(0, Vec::len);
        total_samples += item
            .get("times")
            .and_then(Value::as_array)
            .map_or(0, Vec::len);
    }
    if total_keys > MAX_REQUEST_KEYS {
        return Err(Error::new(
            "request-key-count",
            "$/items",
            "Request exceeds 32768 keys",
        ));
    }
    if total_samples > MAX_REQUEST_SAMPLES {
        return Err(Error::new(
            "request-sample-count",
            "$/items",
            "Request exceeds 65536 samples",
        ));
    }
    let items = value
        .get_mut("items")
        .and_then(Value::as_array_mut)
        .expect("validated array");
    let items = std::mem::take(items)
        .into_iter()
        .map(|item| {
            let id = item["id"].as_str().expect("validated ID").to_owned();
            (id, item)
        })
        .collect();
    Ok(Request { items, max_nodes })
}

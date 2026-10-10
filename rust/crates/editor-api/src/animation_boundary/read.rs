use super::model::Error;
use serde_json::{Map, Value};

pub(super) fn path(parent: &str, field: &str) -> String {
    format!("{parent}/{}", field.replace('~', "~0").replace('/', "~1"))
}

pub(super) fn object<'a>(
    value: &'a Value,
    location: &str,
    allowed: &[&str],
) -> Result<&'a Map<String, Value>, Error> {
    let object = value
        .as_object()
        .ok_or_else(|| Error::new("schema", location, "Expected an object"))?;
    if let Some(key) = object.keys().find(|key| !allowed.contains(&key.as_str())) {
        return Err(Error::new(
            "unknown-field",
            path(location, key),
            "Field is not part of the canonical v1 DTO",
        ));
    }
    Ok(object)
}

pub(super) fn required<'a>(
    object: &'a Map<String, Value>,
    field: &str,
    location: &str,
) -> Result<&'a Value, Error> {
    object.get(field).ok_or_else(|| {
        Error::new(
            "missing-field",
            path(location, field),
            "Required field is missing",
        )
    })
}

pub(super) fn number(value: &Value, location: &str) -> Result<f64, Error> {
    value
        .as_f64()
        .filter(|value| value.is_finite())
        .ok_or_else(|| Error::new("finite-number", location, "Expected a finite JSON number"))
}

pub(super) fn array<'a>(value: &'a Value, location: &str) -> Result<&'a Vec<Value>, Error> {
    value
        .as_array()
        .ok_or_else(|| Error::new("schema", location, "Expected an array"))
}

pub(super) fn budget(value: &Value, location: &str, limit: u32) -> Result<u32, Error> {
    let fields = object(value, location, &["maxNodes"])?;
    required(fields, "maxNodes", location)?
        .as_u64()
        .filter(|number| *number <= u64::from(limit))
        .map(|number| number as u32)
        .ok_or_else(|| {
            Error::new(
                "invalid-budget",
                path(location, "maxNodes"),
                "Expected an integer node budget within the advertised limit",
            )
        })
}

pub(super) fn member_number(
    fields: &Map<String, Value>,
    field: &str,
    location: &str,
) -> Result<f64, Error> {
    number(required(fields, field, location)?, &path(location, field))
}

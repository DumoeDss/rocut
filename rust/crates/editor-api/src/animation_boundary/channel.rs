use super::{MAX_ITEM_KEYS, model::*, read};
use crate::animation_numeric::{
    Extrapolation, Handle, IssueKind, MAX_SAFE_TICKS, NumericIssue, ScalarKey, Segment,
    ValidatedChannel,
};
use serde_json::Value;

pub(super) struct Channel {
    pub keys: Vec<ScalarKey>,
    before: Extrapolation,
    after: Extrapolation,
    fallback: f64,
}

impl Channel {
    pub fn validated(&self, location: &str) -> Result<ValidatedChannel<'_>, Error> {
        ValidatedChannel::new(&self.keys, self.before, self.after, self.fallback)
            .map_err(|issue| numeric_error(issue, location))
    }
}

pub(super) fn prepare(value: &Value, fallback: &Value, location: &str) -> Result<Channel, Error> {
    let fields = read::object(value, location, &["keys", "extrapolation"])?;
    let keys_path = read::path(location, "keys");
    let source = read::array(read::required(fields, "keys", location)?, &keys_path)?;
    if source.len() > MAX_ITEM_KEYS {
        return Err(Error::new(
            "item-key-count",
            keys_path,
            "Item exceeds 8192 keys",
        ));
    }
    let mut keys = Vec::with_capacity(source.len());
    for (index, value) in source.iter().enumerate() {
        let key_path = format!("{keys_path}/{index}");
        let result = key(value, &key_path);
        keys.push(result.map_err(|mut error| {
            error.key_index = Some(index);
            error
        })?);
    }
    let edge_path = read::path(location, "extrapolation");
    let edges = read::object(
        read::required(fields, "extrapolation", location)?,
        &edge_path,
        &["before", "after"],
    )?;
    let before = extrapolation(
        read::required(edges, "before", &edge_path)?,
        &read::path(&edge_path, "before"),
    )?;
    let after = extrapolation(
        read::required(edges, "after", &edge_path)?,
        &read::path(&edge_path, "after"),
    )?;
    let fallback_path = format!(
        "{}/fallbackValue",
        location.strip_suffix("/channel").unwrap_or(location)
    );
    Ok(Channel {
        keys,
        before,
        after,
        fallback: read::number(fallback, &fallback_path)?,
    })
}

fn key(value: &Value, location: &str) -> Result<ScalarKey, Error> {
    let fields = read::object(
        value,
        location,
        &[
            "time",
            "value",
            "segmentToNext",
            "leftHandle",
            "rightHandle",
        ],
    )?;
    let time = read::required(fields, "time", location)?
        .as_u64()
        .filter(|value| *value <= MAX_SAFE_TICKS)
        .ok_or_else(|| {
            Error::new(
                "invalid-key-time",
                read::path(location, "time"),
                "Key time must be a nonnegative safe integer JSON token",
            )
        })?;
    let segment = match read::required(fields, "segmentToNext", location)?.as_str() {
        Some("step") => Segment::Step,
        Some("linear") => Segment::Linear,
        Some("bezier") => Segment::Bezier,
        _ => {
            return Err(Error::new(
                "invalid-segment",
                read::path(location, "segmentToNext"),
                "Expected step, linear, or bezier",
            ));
        }
    };
    Ok(ScalarKey {
        time,
        value: read::member_number(fields, "value", location)?,
        segment,
        left: fields
            .get("leftHandle")
            .map(|value| handle(value, &read::path(location, "leftHandle")))
            .transpose()?,
        right: fields
            .get("rightHandle")
            .map(|value| handle(value, &read::path(location, "rightHandle")))
            .transpose()?,
    })
}

fn handle(value: &Value, location: &str) -> Result<Handle, Error> {
    let fields = read::object(value, location, &["dt", "dv"])?;
    let dt = read::required(fields, "dt", location)?
        .as_i64()
        .filter(|value| value.unsigned_abs() <= MAX_SAFE_TICKS)
        .ok_or_else(|| {
            Error::new(
                "invalid-handle",
                read::path(location, "dt"),
                "Handle dt must be a signed safe integer JSON token",
            )
        })?;
    Ok(Handle {
        dt,
        dv: read::member_number(fields, "dv", location)?,
    })
}

fn extrapolation(value: &Value, location: &str) -> Result<Extrapolation, Error> {
    match value.as_str() {
        Some("hold") => Ok(Extrapolation::Hold),
        Some("linear") => Ok(Extrapolation::Linear),
        _ => Err(Error::new(
            "invalid-extrapolation",
            location,
            "Expected hold or linear",
        )),
    }
}

pub(super) fn numeric_error(issue: NumericIssue, location: &str) -> Error {
    let (code, message) = match issue.kind {
        IssueKind::InvalidKeyTime => (
            "invalid-key-time",
            "Key time is outside the safe integer range",
        ),
        IssueKind::UnorderedKeys => ("unordered-keys", "Key times must be strictly increasing"),
        IssueKind::InvalidHandle => (
            "invalid-handle",
            "Handle offset has an invalid sign or range",
        ),
        IssueKind::NonFiniteInput => ("non-finite-input", "Channel inputs must be finite"),
        IssueKind::NonFiniteTime => ("non-finite-time", "Sample time must be finite"),
        IssueKind::NonFiniteArithmetic => (
            "non-finite-arithmetic",
            "Scalar evaluation produced non-finite arithmetic",
        ),
        IssueKind::InvalidDomain => ("invalid-domain", "Domain must be finite and ordered"),
        IssueKind::InvalidBounds => ("invalid-bounds", "Bounds must be finite and ordered"),
        IssueKind::OutsideBounds => (
            "outside-bounds",
            "An evaluated witness is outside the displayed bounds",
        ),
        IssueKind::InvalidBudget => (
            "invalid-budget",
            "Inspection node budget is outside its limit",
        ),
        IssueKind::BudgetExhausted => (
            "budget-exhausted",
            "Inspection did not prove the remaining domain within its node budget",
        ),
    };
    let path = issue.key_index.map_or_else(
        || location.to_owned(),
        |index| format!("{location}/keys/{index}"),
    );
    Error {
        key_index: issue.key_index,
        ..Error::new(code, path, message)
    }
}

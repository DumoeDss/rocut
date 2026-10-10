use super::{MAX_ITEM_SAMPLES, channel, model::*, read};
use serde_json::Value;

pub(super) fn run(request: Request) -> Response {
    let results = request
        .items
        .into_iter()
        .enumerate()
        .map(|(index, (id, value))| {
            let result = item(&value, &format!("$/items/{index}"))
                .unwrap_or_else(|error| ResultKind::Error { error });
            Item { id, result }
        })
        .collect();
    Response::batch(results, None)
}

fn item(value: &Value, location: &str) -> Result<ResultKind, Error> {
    let fields = read::object(
        value,
        location,
        &["id", "channel", "fallbackValue", "times"],
    )?;
    let channel_path = read::path(location, "channel");
    let prepared = channel::prepare(
        read::required(fields, "channel", location)?,
        read::required(fields, "fallbackValue", location)?,
        &channel_path,
    )?;
    let channel = prepared.validated(&channel_path)?;
    let times_path = read::path(location, "times");
    let times = read::array(read::required(fields, "times", location)?, &times_path)?;
    if times.len() > MAX_ITEM_SAMPLES {
        return Err(Error::new(
            "item-sample-count",
            times_path,
            "Item exceeds 4096 sample times",
        ));
    }
    let mut values = Vec::with_capacity(times.len());
    for (index, value) in times.iter().enumerate() {
        let result = read::number(value, &format!("{times_path}/{index}")).and_then(|time| {
            channel
                .sample(time)
                .map_err(|issue| channel::numeric_error(issue, &channel_path))
        });
        values.push(result.map_err(|mut error| {
            error.sample_index = Some(index);
            error
        })?);
    }
    // Nothing escapes this item until every requested sample is finite.
    Ok(ResultKind::Values { values })
}

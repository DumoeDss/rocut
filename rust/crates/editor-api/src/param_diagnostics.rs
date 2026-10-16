use crate::model::Param;

pub(crate) fn invalid_value_message(param: &Param) -> String {
    match param.kind.as_str() {
        "number" => {
            let multiplier = param.display_multiplier.unwrap_or(1.0);
            let bound = |value: Option<f64>| value.map_or("unbounded".into(), |n| n.to_string());
            let display_range = format!("[{}, {}]", bound(param.min), bound(param.max));
            if !multiplier.is_finite() || multiplier == 0.0 {
                return format!(
                    "Invalid numeric parameter definition; consult editing/catalog (displayMultiplier={multiplier})"
                );
            }
            let (min, max) = if multiplier > 0.0 {
                (param.min, param.max)
            } else {
                (param.max, param.min)
            };
            format!(
                "Expected a finite number in stored units, range [{}, {}]. Display value = stored value * {multiplier}; catalog min/max are display units {display_range}, not stored units. Divide a display value by {multiplier} before sending it.",
                bound(min.map(|n| n / multiplier)),
                bound(max.map(|n| n / multiplier)),
            )
        }
        "select" => format!(
            "Expected one of the catalog option values: {}",
            param
                .options
                .iter()
                .map(|option| option.value.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        ),
        kind => format!("Invalid parameter type; expected {kind}; consult editing/catalog"),
    }
}

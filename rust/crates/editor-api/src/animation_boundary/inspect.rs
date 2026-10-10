use super::{NUMERIC_SEMANTICS, VERSION, channel, model::*, read};
use crate::animation_numeric::{
    CheckBudget, ClosedDomain, DomainCheck, IssueKind, MAX_CHECK_NODES, NumericBounds,
};
use serde_json::Value;

pub(super) fn run(request: Request) -> Response {
    let mut visited = 0;
    let results = request
        .items
        .into_iter()
        .enumerate()
        .map(|(index, (id, value))| {
            let result = item(
                &value,
                &format!("$/items/{index}"),
                request.max_nodes - visited,
            )
            .map(|(result, nodes)| {
                visited += nodes;
                result
            })
            .unwrap_or_else(|error| ResultKind::Error { error });
            Item { id, result }
        })
        .collect();
    Response::batch(
        results,
        Some(RequestBudget {
            max_nodes: request.max_nodes,
            visited_nodes: visited,
        }),
    )
}

fn item(value: &Value, location: &str, remaining: u32) -> Result<(ResultKind, u32), Error> {
    let fields = read::object(
        value,
        location,
        &[
            "id",
            "channel",
            "fallbackValue",
            "domain",
            "bounds",
            "budget",
        ],
    )?;
    let channel_path = read::path(location, "channel");
    let prepared = channel::prepare(
        read::required(fields, "channel", location)?,
        read::required(fields, "fallbackValue", location)?,
        &channel_path,
    )?;
    let channel = prepared.validated(&channel_path)?;
    let domain = domain(
        read::required(fields, "domain", location)?,
        &read::path(location, "domain"),
    )?;
    let bounds = bounds(
        read::required(fields, "bounds", location)?,
        &read::path(location, "bounds"),
    )?;
    let requested_nodes = read::budget(
        read::required(fields, "budget", location)?,
        &read::path(location, "budget"),
        MAX_CHECK_NODES,
    )?;
    let budget = ItemBudget {
        requested_nodes,
        effective_nodes: requested_nodes.min(remaining),
    };
    // Validate every item even when preceding channels consumed the entire request
    // budget. Unstarted, valid items remain in place and are explicitly unresolved.
    if remaining == 0 {
        return Ok((
            ResultKind::Unresolved {
                domain,
                unproven_domain: domain,
                reason: Error::new(
                    "request-budget-exhausted",
                    read::path(location, "budget"),
                    "Item was not started because the request node budget is exhausted",
                ),
                visited_nodes: 0,
                budget,
            },
            0,
        ));
    }
    let check = channel.check_closed_domain(
        ClosedDomain {
            start: domain.start,
            end: domain.end,
        },
        bounds,
        CheckBudget::new(budget.effective_nodes)
            .map_err(|issue| channel::numeric_error(issue, &channel_path))?,
    );
    match check {
        DomainCheck::Safe {
            values,
            displayed,
            visited_nodes,
        } => Ok((
            ResultKind::Safe {
                domain,
                values: Enclosure {
                    min: values.min,
                    max: values.max,
                },
                displayed: Enclosure {
                    min: displayed.min,
                    max: displayed.max,
                },
                visited_nodes,
                budget,
                numeric_semantics: NUMERIC_SEMANTICS,
                certificate_version: VERSION,
            },
            visited_nodes,
        )),
        DomainCheck::Violation {
            time,
            value,
            issue,
            visited_nodes,
        } => Ok((
            ResultKind::Violation {
                domain,
                time,
                value,
                reason: channel::numeric_error(issue, &channel_path),
                visited_nodes,
                budget,
            },
            visited_nodes,
        )),
        DomainCheck::Unresolved {
            domain: unproven,
            issue,
            visited_nodes,
        } => {
            // Input errors are errors, not retryable budget exhaustion, even if a
            // future kernel reports one through its Unresolved variant.
            if issue.kind != IssueKind::BudgetExhausted {
                return Err(channel::numeric_error(issue, &channel_path));
            }
            let mut reason = channel::numeric_error(issue, &channel_path);
            if budget.effective_nodes < requested_nodes {
                reason.code = "request-budget-exhausted";
                reason.message = "Inspection was limited by the remaining request node budget";
            }
            Ok((
                ResultKind::Unresolved {
                    domain,
                    unproven_domain: Range {
                        start: unproven.start,
                        end: unproven.end,
                    },
                    reason,
                    visited_nodes,
                    budget,
                },
                visited_nodes,
            ))
        }
    }
}

fn domain(value: &Value, location: &str) -> Result<Range, Error> {
    let fields = read::object(value, location, &["start", "end"])?;
    let start = read::member_number(fields, "start", location)?;
    let end = read::member_number(fields, "end", location)?;
    if start > end {
        return Err(Error::new(
            "invalid-domain",
            location,
            "Domain start must not exceed its end",
        ));
    }
    Ok(Range { start, end })
}

fn bounds(value: &Value, location: &str) -> Result<NumericBounds, Error> {
    let fields = read::object(value, location, &["min", "max", "displayMultiplier"])?;
    let min = fields
        .get("min")
        .map(|value| read::number(value, &read::path(location, "min")))
        .transpose()?;
    let max = fields
        .get("max")
        .map(|value| read::number(value, &read::path(location, "max")))
        .transpose()?;
    let display_multiplier = read::member_number(fields, "displayMultiplier", location)?;
    if matches!((min, max), (Some(min), Some(max)) if min > max) {
        return Err(Error::new(
            "invalid-bounds",
            location,
            "Minimum must not exceed maximum",
        ));
    }
    Ok(NumericBounds {
        min,
        max,
        display_multiplier,
    })
}

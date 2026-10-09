//! Shared authored effect policy; rendering still resolves passes at frame time.
use crate::model::{Effect, Issue, Param};
use bridge::export;
use serde::Deserialize;
use std::collections::{BTreeMap, BTreeSet};

pub(crate) fn validate(
    effects: &[Effect],
    catalog: &BTreeMap<String, Vec<Param>>,
    path: &str,
    issues: &mut Vec<Issue>,
) {
    let mut ids = BTreeSet::new();
    for effect in effects {
        let location = format!("{path}.{}", effect.id);
        crate::unique_id(&effect.id, &mut ids, &location, issues);
        crate::effect_params::validate(
            &effect.kind,
            &effect.params,
            &format!("{location}.params"),
            issues,
        );
        match catalog.get(&effect.kind) {
            None => issues.push(Issue::new(&location, "Unknown effect type")),
            Some(params) => {
                crate::validate_params(
                    &effect.params,
                    params,
                    &format!("{location}.params"),
                    issues,
                );
                for param in params {
                    if param.required != Some(false) && !effect.params.contains_key(&param.key) {
                        issues.push(Issue::new(
                            &format!("{location}.params.{}", param.key),
                            "Required effect parameter missing; use catalog defaults",
                        ));
                    }
                }
            }
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    effects: Vec<Effect>,
    catalog: BTreeMap<String, Vec<Param>>,
}

/// Project master is an ordered authored stack, not raw GPU shader/pass transport.
/// Disabled entries are validated too; enabling cannot expose unchecked data.
#[export]
pub fn validate_master_effects_json(input: String) -> String {
    let mut issues = Vec::new();
    if input.len() > 1024 * 1024 {
        issues.push(Issue::new(
            "masterEffects",
            "Master effect request exceeds 1 MiB",
        ));
    } else {
        match serde_json::from_str::<Request>(&input) {
            Ok(request) if request.effects.len() <= 256 => {
                validate(
                    &request.effects,
                    &request.catalog,
                    "masterEffects",
                    &mut issues,
                );
            }
            Ok(_) => issues.push(Issue::new(
                "masterEffects",
                "Master stack exceeds 256 effects",
            )),
            Err(error) => issues.push(Issue::new(
                "masterEffects",
                &format!("Invalid master effect schema: {error}"),
            )),
        }
    }
    serde_json::to_string(&issues).expect("effect issues serialize")
}

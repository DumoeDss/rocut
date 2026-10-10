//! Same-clock graph composition. Role masks select, never relabel, child pixels.
use super::model::{PlanNode, Role};
use serde::{Deserialize, Serialize};

pub const MAX_ITEMS: usize = 16;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Item {
    pub input: String,
    pub roles: Vec<Role>,
}

#[derive(Serialize)]
pub struct ItemPlan {
    pub roles: Vec<Role>,
    pub input: Box<PlanNode>,
}

pub fn valid(items: &[Item]) -> bool {
    !items.is_empty()
        && items.len() <= MAX_ITEMS
        && items.iter().all(|item| {
            !item.input.is_empty()
                && !item.roles.is_empty()
                && item.roles.len() <= 4
                && item
                    .roles
                    .iter()
                    .enumerate()
                    .all(|(i, role)| !item.roles[..i].contains(role))
        })
}

pub fn catalog_entry() -> serde_json::Value {
    serde_json::json!({"items":{"min":1,"max":MAX_ITEMS},
        "roles":["background","subject","graphics","foreground"],
        "roleMask":"required nonempty unique selection; no role reassignment",
        "clock":"same Rust clock for every input; wrap layers in ref to remap the complete shot",
        "composite":"source-over in item order within canonical role order",
        "retainedChildSurfaces":1,"drawingWork":"1 + item count, plus all expanded child work",
        "ownerAdmission":"conservative: every input occurrence is admitted even when masked"})
}

#[cfg(test)]
mod tests {
    use super::super::model::Recipe;
    use super::*;
    use serde_json::json;
    #[test]
    fn finite_unique_role_masks() {
        let item = |roles| Item {
            input: "shot".into(),
            roles,
        };
        assert!(valid(&[item(vec![Role::Background, Role::Subject])]));
        assert!(!valid(&[]));
        assert!(!valid(&[item(vec![])]));
        assert!(!valid(&[item(vec![Role::Subject, Role::Subject])]));
        assert!(!valid(
            &(0..17)
                .map(|_| item(vec![Role::Background]))
                .collect::<Vec<_>>()
        ));
        assert!(
            serde_json::from_str::<Item>(r#"{"input":"x","roles":["subject"],"opacity":0.5}"#)
                .is_err()
        );
    }

    fn recipe() -> serde_json::Value {
        json!({"version":1,"root":"sample","songStartSeconds":0,"outputRoles":["background","subject"],
        "nodes":[
            {"id":"a","scene":{"kind":"solid","role":"background","color":[1,0,0,1]}},
            {"id":"b","scene":{"kind":"solid","role":"subject","color":[0,1,0,1]}},
            {"id":"timed","scene":{"kind":"transition","from":"a","to":"b","span":{"startFrame":0,"durationFrames":16},"easing":"linear","style":{"kind":"xfade"}}},
            {"id":"shot","scene":{"kind":"layers","items":[{"input":"timed","roles":["background"]},{"input":"timed","roles":["subject"]}]}},
            {"id":"sample","scene":{"kind":"ref","input":"shot","timeMap":[{"atFrame":0,"sourceFrame":8},{"atFrame":23,"sourceFrame":8}]}}
        ]})
    }

    #[test]
    fn complete_graph_remap_shares_clock_and_keeps_role_masks() {
        let recipe: Recipe = serde_json::from_value(recipe()).unwrap();
        assert!(recipe.validate(&[], 24, 64, 32, 5000).is_empty());
        for frame in [0, 11, 23, 0] {
            let plan = serde_json::to_value(
                recipe
                    .resolve(frame, 5000, 7, 64, 32, None, &[], frame * 5000, None)
                    .unwrap(),
            )
            .unwrap();
            let items = &plan["root"]["input"]["items"];
            assert_eq!(plan["root"]["sampledFrame"], 8);
            assert_eq!(items[0]["roles"], json!(["background"]));
            assert_eq!(items[1]["roles"], json!(["subject"]));
            assert_eq!(items[0]["input"]["progress"], 0.5);
            assert_eq!(items[0]["input"], items[1]["input"]);
        }
    }

    #[test]
    fn unknown_cycle_expanded_work_and_depth_are_not_hidden_by_masks() {
        for input in ["missing", "shot"] {
            let mut source = recipe();
            source["nodes"][3]["scene"]["items"][0]["input"] = json!(input);
            let recipe: Recipe = serde_json::from_value(source).unwrap();
            assert!(!recipe.validate(&[], 24, 64, 32, 5000).is_empty());
        }
        let mut source = recipe();
        let nodes = source["nodes"].as_array_mut().unwrap();
        for i in 0..3 {
            let input = if i == 0 {
                "a".to_owned()
            } else {
                format!("level{}", i - 1)
            };
            nodes.push(json!({"id":format!("level{i}"),"scene":{"kind":"layers","items":(0..16).map(|_|json!({"input":input,"roles":["foreground"]})).collect::<Vec<_>>()}}));
        }
        source["root"] = json!("level2");
        let expanded: Recipe = serde_json::from_value(source).unwrap();
        assert!(!expanded.validate(&[], 24, 64, 32, 5000).is_empty());
        let mut source = recipe();
        for i in 0..10 {
            let input = if i == 0 {
                "a".to_owned()
            } else {
                format!("depth{}", i - 1)
            };
            source["nodes"].as_array_mut().unwrap().push(json!({"id":format!("depth{i}"),"scene":{"kind":"layers","items":[{"input":input,"roles":["background"]}]}}));
        }
        source["root"] = json!("depth9");
        let deep: Recipe = serde_json::from_value(source).unwrap();
        assert!(!deep.validate(&[], 24, 64, 32, 5000).is_empty());
    }
}

use super::*;
use serde_json::{Value, json};

fn resource(id: &str) -> Resource {
    serde_json::from_value(json!({"id":id,"kind":"image","mimeType":"image/png",
        "byteLength":90,"sha256":"a".repeat(64),
        "attachmentKey":format!("programmatic-sha256-{}","a".repeat(64))}))
    .unwrap()
}
fn measured(resource: &Resource, width: u32, height: u32) -> Measurement {
    serde_json::from_value(json!({"resource":resource,"width":width,"height":height})).unwrap()
}

#[test]
fn collector_only_requests_explicit_needs_with_full_identity() {
    let resources = vec![resource("a.png"), resource("b.png")];
    assert!(requests(&resources, &[]).unwrap().is_empty());
    let needs = requests(&resources, &["b.png", "b.png"]).unwrap();
    assert_eq!(needs.len(), 1);
    assert!(needs[0].resource == resources[1]);
    assert!(requests(&resources, &["absent.png"]).is_err());
    assert!(requests(&[resources[0].clone(), resources[0].clone()], &["a.png"]).is_err());
}

#[test]
fn no_fact_consumer_does_not_add_a_new_resource_validation_gate() {
    let incomplete = resource("");
    assert!(!crate::programmatic_resources::validate(&[incomplete.clone()]).is_empty());
    assert!(requests(&[incomplete.clone()], &[]).unwrap().is_empty());
    assert!(requests(&[incomplete], &[""]).is_err());
}

#[test]
fn facts_must_match_every_declared_identity_field() {
    let image = resource("cover.png");
    let expected = vec![Request {
        resource: image.clone(),
    }];
    let context = Context::new(&expected, &[measured(&image, 8, 3)]).unwrap();
    assert_eq!(
        context.image("cover.png").unwrap(),
        Dimensions {
            width: 8,
            height: 3
        }
    );
    assert!(context.image("other.png").is_err());
    for (field, replacement) in [
        ("id", json!("other.png")),
        ("kind", json!("font")),
        ("mimeType", json!("image/jpeg")),
        ("byteLength", json!(91)),
        ("sha256", json!("b".repeat(64))),
        ("attachmentKey", json!("another-key")),
    ] {
        let mut value = serde_json::to_value(&image).unwrap();
        value[field] = replacement;
        let wrong = serde_json::from_value(value).unwrap();
        assert!(
            Context::new(&expected, &[measured(&wrong, 8, 3)]).is_err(),
            "{field}"
        );
    }
}

#[test]
fn facts_reject_missing_extra_duplicate_and_unbounded_geometry() {
    let image = resource("cover.png");
    let expected = vec![Request {
        resource: image.clone(),
    }];
    assert!(Context::new(&expected, &[]).is_err());
    assert!(Context::new(&[], &[measured(&image, 8, 3)]).is_err());
    assert!(Context::new(&expected, &[measured(&image, 8, 3), measured(&image, 8, 3)]).is_err());
    for (w, h) in [(0, 1), (1, 0), (8193, 1), (1, 8193), (8192, 8192)] {
        assert!(Context::new(&expected, &[measured(&image, w, h)]).is_err());
    }
    let second = resource("second.png");
    let two = vec![
        Request {
            resource: image.clone(),
        },
        Request {
            resource: second.clone(),
        },
    ];
    assert!(
        Context::new(
            &two,
            &[measured(&image, 8192, 4096), measured(&second, 1, 1)]
        )
        .is_err()
    );
    assert!(Context::new(&two, &[measured(&image, 1, 1), measured(&image, 1, 1)]).is_err());
}

#[test]
fn facts_schema_rejects_author_shortcuts_and_invalid_scalars() {
    let valid = json!({"resource":resource("image.png"),"width":8,"height":3});
    for invalid in [Value::Null, json!({"id":"image.png","width":8,"height":3})] {
        assert!(serde_json::from_value::<Measurement>(invalid).is_err());
    }
    for value in [
        json!(-1),
        json!(1.5),
        json!("8"),
        Value::Null,
        json!(u64::MAX),
    ] {
        let mut invalid = valid.clone();
        invalid["width"] = value;
        assert!(serde_json::from_value::<Measurement>(invalid).is_err());
    }
    let mut extra = valid;
    extra["authorVerified"] = json!(true);
    assert!(serde_json::from_value::<Measurement>(extra).is_err());
}

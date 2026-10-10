use super::*;
use crate::mv_recipe::train;
use serde_json::json;
use std::path::PathBuf;
fn resource(
    id: &str,
    family: &str,
    weight: u16,
    axes: serde_json::Value,
    bytes: &[u8],
) -> Resource {
    let sha = format!("{:x}", Sha256::digest(bytes));
    serde_json::from_value(json!({"id":id,"kind":"font","mimeType":"font/ttf","byteLength":bytes.len(),"sha256":sha,"attachmentKey":format!("programmatic-sha256-{sha}"),"font":{"family":family,"style":"normal","weight":weight,"axes":axes}})).unwrap()
}
fn instances() -> Vec<FontInstance> {
    serde_json::from_value(json!([
        {"id":"font/mincho800","resourceId":"font/source/mincho800","weight":800,"axes":{}},
        {"id":"font/mincho700","resourceId":"font/source/mincho700","weight":700,"axes":{}},
        {"id":"font/dot400","resourceId":"font/source/dot400","weight":400,"axes":{}},
        {"id":"font/noto800","resourceId":"font/source/noto-variable","weight":800,"axes":{"wght":800}},
        {"id":"font/noto700","resourceId":"font/source/noto-variable","weight":700,"axes":{"wght":700}},
        {"id":"font/noto400","resourceId":"font/source/noto-variable","weight":400,"axes":{"wght":400}}
    ])).unwrap()
}
fn roles() -> Vec<&'static str> {
    vec![
        "font/mincho800",
        "font/mincho700",
        "font/dot400",
        "font/noto800",
        "font/noto700",
        "font/noto400",
    ]
}
fn metadata_resources() -> Vec<Resource> {
    vec![
        resource(
            "font/source/mincho800",
            "Shippori Mincho B1",
            800,
            json!({}),
            &[1],
        ),
        resource(
            "font/source/mincho700",
            "Shippori Mincho B1",
            700,
            json!({}),
            &[2],
        ),
        resource("font/source/dot400", "DotGothic16", 400, json!({}), &[3]),
        resource(
            "font/source/noto-variable",
            "Noto Serif JP",
            200,
            json!({"wght":200}),
            &[4],
        ),
    ]
}
#[test]
fn closed_instances_never_allow_coverage_loss_or_metadata_override() {
    let sources = metadata_resources();
    let declared = instances();
    assert!(programmatic_resources::validate(&sources).is_empty());
    assert_eq!(
        metadata(&sources, &declared, &roles())
            .unwrap()
            .resources
            .len(),
        6
    );
    let mut changed = declared.clone();
    changed.pop();
    assert!(metadata(&sources, &changed, &roles()).is_err());
    let mut changed = declared.clone();
    changed[0] = changed[1].clone();
    assert!(metadata(&sources, &changed, &roles()).is_err());
    let mut changed = declared.clone();
    changed[3].resource_id = "font/noto800".into();
    assert!(metadata(&sources, &changed, &roles()).is_err());
    let mut changed = declared.clone();
    changed[3].axes.insert("wdth".into(), 100.0);
    assert!(metadata(&sources, &changed, &roles()).is_err());
    let mut changed = declared.clone();
    changed[3].axes.insert("wght".into(), 700.0);
    assert!(metadata(&sources, &changed, &roles()).is_err());
    let mut image = sources.clone();
    let mut value = serde_json::to_value(&image[3]).unwrap();
    value["kind"] = json!("image");
    value["mimeType"] = json!("image/png");
    value.as_object_mut().unwrap().remove("font");
    image[3] = serde_json::from_value(value).unwrap();
    assert!(metadata(&image, &declared, &roles()).is_err());
    for key in ["family", "style", "mimeType", "sha256", "attachmentKey"] {
        let mut value = serde_json::to_value(&declared[0]).unwrap();
        value[key] = json!("override");
        assert!(serde_json::from_value::<FontInstance>(value).is_err());
    }
}
#[test]
fn aliases_cannot_shadow_physical_sources_or_duplicate_font_bodies() {
    let mut sources = metadata_resources();
    let declared = instances();
    let mut changed = declared.clone();
    changed[0].id = "font/source/mincho800".into();
    let mut expected = roles();
    expected[0] = "font/source/mincho800";
    assert!(metadata(&sources, &changed, &expected).is_err());
    let mut value = serde_json::to_value(&sources[3]).unwrap();
    value["id"] = json!("font/source/noto-shadow");
    value["font"]["weight"] = json!(400);
    value["font"]["axes"] = json!({"wght":400});
    sources.push(serde_json::from_value(value).unwrap());
    assert!(programmatic_resources::validate(&sources).is_empty());
    assert!(metadata(&sources, &declared, &roles()).is_err());
}
struct Actual {
    sources: Vec<Resource>,
    bodies: BTreeMap<String, Vec<u8>>,
    instances: Vec<FontInstance>,
    settings: train::Settings,
}
fn actual() -> Actual {
    let directory = PathBuf::from(
        std::env::var("ROCUT_TEST_NIGHT_FONT_ROOT")
            .expect("explicit actual motion-text font root required"),
    );
    let mincho700 = PathBuf::from(
        std::env::var("ROCUT_TEST_MV_MINCHO700")
            .expect("explicit pinned real static Mincho700 required"),
    );
    assert!(directory.is_absolute() && mincho700.is_absolute());
    let definitions = [
        (
            "font/source/mincho800",
            directory.join("shippori-mincho-b1-extrabold.ttf"),
            "Shippori Mincho B1",
            800,
            json!({}),
        ),
        (
            "font/source/mincho700",
            mincho700,
            "Shippori Mincho B1",
            700,
            json!({}),
        ),
        (
            "font/source/dot400",
            directory.join("dot-gothic-16-regular.ttf"),
            "DotGothic16",
            400,
            json!({}),
        ),
        (
            "font/source/noto-variable",
            directory.join("noto-serif-jp-variable.ttf"),
            "Noto Serif JP",
            200,
            json!({"wght":200}),
        ),
    ];
    let mut sources = Vec::new();
    let mut bodies = BTreeMap::new();
    for (id, path, family, weight, axes) in definitions {
        let bytes = std::fs::read(path).unwrap();
        if id == "font/source/mincho700" {
            assert_eq!(
                format!("{:x}", Sha256::digest(&bytes)),
                "d20f3981afb8bceda5fdf8f0fb29ba51eb21518644612ccd8a183e5bd433e25a"
            );
        }
        sources.push(resource(id, family, weight, axes, &bytes));
        bodies.insert(id.into(), bytes);
    }
    let settings=serde_json::from_value(json!({"bg":"bg","fonts":{"mincho800":"font/mincho800","noto800":"font/noto800","mincho700":"font/mincho700","noto700":"font/noto700","dot400":"font/dot400","noto400":"font/noto400"},"beats":{"kind":"manual","songTicks":[]},"bpm":120,"downbeatIndex0":0})).unwrap();
    Actual {
        sources,
        bodies,
        instances: instances(),
        settings,
    }
}
#[test]
#[ignore = "explicit pinned real SFNT fixture paths; root owns integrated native gate"]
fn actual_variable_file_admits_all_six_instances_without_duplicate_transmission() {
    let f = actual();
    assert!(programmatic_resources::validate(&f.sources).is_empty());
    let physical: BTreeMap<_, _> = f
        .bodies
        .iter()
        .map(|(id, b)| (id.clone(), b.as_slice()))
        .collect();
    validate_sources(&f.sources, &physical).unwrap();
    let aliases = metadata(&f.sources, &f.instances, &roles()).unwrap();
    let bound = instance_bodies(&f.instances, &physical).unwrap();
    for id in ["font/noto800", "font/noto700", "font/noto400"] {
        assert_eq!(
            bound[id].as_ptr(),
            physical["font/source/noto-variable"].as_ptr()
        );
    }
    assert_eq!(aliases.resources.len(), 6);
    assert_eq!(aliases.instance_bytes, 72_969_312);
    assert!(f.sources.iter().map(Resource::byte_length).sum::<u64>() < 64 * 1024 * 1024);
    f.settings.admit_fonts(&aliases.resources, &bound).unwrap();
}
#[test]
#[ignore = "explicit pinned real SFNT fixture paths; root owns integrated native gate"]
fn actual_sfmt_weight_axis_and_sha_mismatches_are_rejected() {
    let f = actual();
    let physical: BTreeMap<_, _> = f
        .bodies
        .iter()
        .map(|(id, b)| (id.clone(), b.as_slice()))
        .collect();
    let mut duplicate = f.instances.clone();
    duplicate[0].weight = 700;
    assert!(metadata(&f.sources, &duplicate, &roles()).is_err());
    for (index, weight, axes) in [
        // 600 remains a distinct logical instance, so this case exercises
        // actual font admission rather than the earlier duplicate-face gate.
        (0, 600, json!({})),
        (3, 1000, json!({"wght":1000})),
        (3, 900, json!({"wght":900})),
    ] {
        let mut changed = f.instances.clone();
        changed[index].weight = weight;
        changed[index].axes = serde_json::from_value(axes).unwrap();
        let aliases = metadata(&f.sources, &changed, &roles()).unwrap();
        let bound = instance_bodies(&changed, &physical).unwrap();
        assert!(f.settings.admit_fonts(&aliases.resources, &bound).is_err());
    }
    let mut wrong = f.sources.clone();
    let mut value = serde_json::to_value(&wrong[0]).unwrap();
    value["font"]["weight"] = json!(700);
    wrong[0] = serde_json::from_value(value).unwrap();
    assert!(validate_sources(&wrong, &physical).is_err());
    let mut damaged = f.bodies.clone();
    damaged.get_mut("font/source/noto-variable").unwrap()[0] ^= 1;
    let bodies = damaged
        .iter()
        .map(|(id, b)| (id.clone(), b.as_slice()))
        .collect();
    assert!(validate_sources(&f.sources, &bodies).is_err());
}
#[test]
#[ignore = "explicit pinned real SFNT fixture paths; root owns integrated native gate"]
fn actual_family_style_mime_source_axes_and_missing_cmap_are_rejected() {
    let f = actual();
    let physical: BTreeMap<_, _> = f
        .bodies
        .iter()
        .map(|(id, b)| (id.clone(), b.as_slice()))
        .collect();
    for (index, key, value) in [
        (0, "family", json!("Noto Serif JP")),
        (0, "style", json!("italic")),
        (0, "axes", json!({"wght":800})),
        (3, "axes", json!({"wdth":200})),
        (3, "axes", json!({})),
    ] {
        let mut sources = f.sources.clone();
        let mut source = serde_json::to_value(&sources[index]).unwrap();
        source["font"][key] = value;
        sources[index] = serde_json::from_value(source).unwrap();
        assert!(validate_sources(&sources, &physical).is_err(), "{key}");
    }
    let mut sources = f.sources.clone();
    let mut source = serde_json::to_value(&sources[0]).unwrap();
    source["mimeType"] = json!("font/otf");
    sources[0] = serde_json::from_value(source).unwrap();
    assert!(validate_sources(&sources, &physical).is_err());
    // Preserve valid face outlines/name/weight but remove glyph routing from
    // BOTH primary and fallback, so correct SFNT metadata cannot hide no cmap.
    let mut damaged = f.bodies.clone();
    for id in ["font/source/mincho700", "font/source/noto-variable"] {
        let bytes = damaged.get_mut(id).unwrap();
        let count = u16::from_be_bytes([bytes[4], bytes[5]]) as usize;
        let entry = (0..count)
            .map(|n| 12 + n * 16)
            .find(|offset| &bytes[*offset..*offset + 4] == b"cmap")
            .unwrap();
        bytes[entry..entry + 4].copy_from_slice(b"cmxx");
    }
    let mut sources = f.sources.clone();
    for source in &mut sources {
        let mut value = serde_json::to_value(&*source).unwrap();
        let sha = format!("{:x}", Sha256::digest(&damaged[&source.id]));
        value["sha256"] = json!(sha);
        value["attachmentKey"] = json!(format!("programmatic-sha256-{sha}"));
        *source = serde_json::from_value(value).unwrap();
    }
    let bodies = damaged
        .iter()
        .map(|(id, b)| (id.clone(), b.as_slice()))
        .collect();
    validate_sources(&sources, &bodies).unwrap();
    let aliases = metadata(&sources, &f.instances, &roles()).unwrap();
    let bound = instance_bodies(&f.instances, &bodies).unwrap();
    assert!(f.settings.admit_fonts(&aliases.resources, &bound).is_err());
}

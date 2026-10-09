use super::{
    Sample,
    clock::Clock,
    hands::Hands,
    model::{Flame, Mode},
    plan::{Command, PaintKind, Step},
};
use crate::{
    mv_image_dimensions::{self, Context},
    mv_recipe::model::Span,
    programmatic_resources::Resource,
};
use serde_json::{Value, json};
fn resources() -> Vec<Resource> {
    serde_json::from_value(json!([{"id":"hand.png","kind":"image","attachmentKey":format!("programmatic-sha256-{}","a".repeat(64)),"mimeType":"image/png","byteLength":100,"sha256":"a".repeat(64)}])).unwrap()
}
fn settings(mode: &str) -> Flame {
    serde_json::from_value(json!({"mode":mode,"beats":{"kind":"manual","songTicks":[0,60000,120000,180000,240000,300000,360000,420000,480000]},
        "bpm":120,"downbeatIndex0":0,"img":"hand.png","face":"hand.png","flameAt":[588,632,662,150,235,46],"vocal":"zero","zoomAt":3.5})).unwrap()
}
fn images(r: &[Resource]) -> Context {
    let request = mv_image_dimensions::requests(r, &["hand.png"]).unwrap();
    Context::new(
        &request,
        &[mv_image_dimensions::Measurement {
            resource: r[0].clone(),
            width: 1024,
            height: 1024,
        }],
    )
    .unwrap()
}
fn sample(t: f64) -> Sample<'static> {
    Sample {
        shot_start_ticks: 0,
        shot_end_ticks: 480000,
        song_ticks: (t * 120000.0).round() as u64,
        analysis: None,
    }
}
fn commands<'a>(data: &'a Value) -> Vec<&'a Value> {
    data["commands"]
        .as_array()
        .unwrap()
        .iter()
        .flat_map(|c| std::iter::once(c).chain(c["commands"].as_array().into_iter().flatten()))
        .collect()
}
#[test]
fn complete_three_modes_emit_bounded_deterministic_transport() {
    let r = resources();
    let i = images(&r);
    for mode in ["breathe", "grow", "dark"] {
        let a = settings(mode);
        assert!(a.valid(
            0,
            &Span {
                start_frame: 0,
                duration_frames: 96
            },
            5000
        ));
        for t in [0.0, 2.13, 3.99, 1.14, 2.13] {
            let p = a.produce(&sample(t), 1920, 1080, &i, &r).unwrap();
            let encoded = serde_json::to_string(&p).unwrap();
            assert_eq!(
                encoded,
                serde_json::to_string(&a.produce(&sample(t), 1920, 1080, &i, &r).unwrap()).unwrap()
            );
            assert!(encoded.len() < 1024 * 1024);
            assert!(p.raster_budget_bytes > 0);
        }
    }
}
#[test]
fn repaired_image_identity_and_three_crop_feathers_are_explicit() {
    let r = resources();
    let i = images(&r);
    let a = settings("breathe");
    let p = a.produce(&sample(2.13), 1920, 1080, &i, &r).unwrap();
    let first = &p.commands[0];
    let Command::Surface { id, size, commands } = first else {
        panic!("base surface required")
    };
    assert_eq!(*id, "fl-base");
    assert_eq!(*size, [1024, 1024]);
    assert!(matches!(&commands[0], Command::Image { .. }));
    let Command::PreparedPatch { request, patch_key } = &commands[1] else {
        panic!("pixel patch required")
    };
    assert_eq!(*patch_key, request.patch_key().unwrap());
    assert_eq!(
        request.binding.flame_at,
        [588.0, 632.0, 662.0, 150.0, 235.0, 46.0]
    );
    assert!(request.binding.resource == r[0]);
    assert_eq!(
        commands[2..]
            .iter()
            .filter(|c| matches!(c,Command::Rect{paint,..} if paint.composite=="destination-out"))
            .count(),
        3
    );
}
#[test]
fn five_layers_each_fill_one_path_with_all_original_tongues() {
    let r = resources();
    let i = images(&r);
    let a = settings("grow");
    let p = serde_json::to_value(a.produce(&sample(2.13), 1920, 1080, &i, &r).unwrap()).unwrap();
    let layers: Vec<_> = commands(&p)
        .into_iter()
        .filter(|c| {
            c["kind"] == "path"
                && c["path"].as_array().is_some_and(|p| p.len() >= 3 * 40)
                && c["paints"][0]["kind"] == "fill"
        })
        .collect();
    assert_eq!(layers.len(), 5);
    assert_eq!(
        layers
            .iter()
            .map(|c| c["path"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|s| s["kind"] == "close")
                .count())
            .collect::<Vec<_>>(),
        [5, 5, 5, 3, 3]
    );
}
#[test]
fn fingertips_reuse_lit_sprite_and_dark_keeps_multiply_and_per_column_blur() {
    let r = resources();
    let i = images(&r);
    let p = serde_json::to_value(
        settings("breathe")
            .produce(&sample(2.13), 1920, 1080, &i, &r)
            .unwrap(),
    )
    .unwrap();
    let fingers = p["commands"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["id"] == "fl-fingers")
        .unwrap();
    assert_eq!(fingers["commands"][0]["surface"], "fl-lit");
    assert_eq!(
        fingers["commands"][1]["paint"]["composite"],
        "destination-in"
    );
    let p = serde_json::to_value(
        settings("dark")
            .produce(&sample(2.13), 1920, 1080, &i, &r)
            .unwrap(),
    )
    .unwrap();
    let list = commands(&p);
    assert!(list.iter().any(|c| c["paint"]["composite"] == "multiply"));
    assert_eq!(
        list.iter()
            .filter(|c| c["surface"] == "fl-rim" && c["raster"]["blurPx"] == 4.0)
            .count(),
        37
    );
    assert_eq!(
        list.iter()
            .filter(|c| c["surface"] == "fl-rim"
                && c["raster"]["blurPx"] == 0.0
                && c["kind"] == "blit")
            .count(),
        37
    );
}
#[test]
fn stop_gutters_and_relights_without_holding_song_motion() {
    let mut a = settings("breathe");
    a.stops = Some(vec![[1.0, 1.5]]);
    let r = resources();
    let i = images(&r);
    let c = Clock::new(&a, &sample(1.3)).unwrap();
    assert_eq!(c.tq, (1.3f64 * 12.0 + 1e-6).floor() / 12.0);
    assert!(Hands::new(&a, &c, &i).unwrap().intensity < 0.1);
    let c = Clock::new(&a, &sample(1.54)).unwrap();
    let h = Hands::new(&a, &c, &i).unwrap();
    assert!(h.intensity > 0.8);
    assert!((h.spark - 0.04).abs() < 1e-12);
}
#[test]
fn missing_vocal_is_explicit_and_original_last_beat_white_is_retained() {
    let r = resources();
    let i = images(&r);
    let mut a = settings("breathe");
    a.vocal = super::model::Vocal::Analysis;
    assert!(
        a.produce(&sample(2.0), 1920, 1080, &i, &r)
            .err()
            .unwrap()
            .contains("vocal")
    );
    a.vocal = super::model::Vocal::Zero;
    let c = Clock::new(&a, &sample(3.99)).unwrap();
    assert!(Hands::new(&a, &c, &i).unwrap().white > 0.9);
    a.zoom_at = None;
    let c = Clock::new(&a, &sample(3.0)).unwrap();
    assert_eq!(c.zoom, 3.5);
}
#[test]
fn dark_extinction_does_not_publish_any_warp_and_grow_uses_64_guard() {
    let mut a = settings("dark");
    a.stops = Some(vec![[1.0, 3.0]]);
    let r = resources();
    let i = images(&r);
    let p = a.produce(&sample(2.0), 1920, 1080, &i, &r).unwrap();
    assert!(
        !p.commands
            .iter()
            .any(|c| matches!(c,Command::Surface{id,..} if *id=="fl-rim"))
    );
    a.mode = Mode::Grow;
    a.beats = super::model::Beats::Manual {
        song_ticks: (0..100).map(|v| v * 1200).collect(),
    };
    let c = Clock::new(&a, &sample(3.0)).unwrap();
    assert_eq!(c.steps(0.0, 3.0, 0.001).unwrap(), 64.0);
}
#[test]
fn fire_layer_paths_are_finite_and_use_one_fill() {
    let mut draw = super::draw::Draw::new(1920.0, 1080.0);
    super::fire::draw(&mut draw, 960.0, 600.0, 250.0, 1.0, 2.0, 1.0);
    for c in draw.commands {
        if let Command::Path { path, paints, .. } = c {
            assert_eq!(paints.len(), 1);
            assert!(matches!(paints[0].kind, PaintKind::Fill));
            for step in path {
                if let Step::MoveTo { point } | Step::LineTo { point } = step {
                    assert!(point.iter().all(|v| v.is_finite()));
                }
            }
        }
    }
}

#[test]
fn prepared_patch_rejects_wrong_key_and_image_surface_identity() {
    let r = resources();
    let i = images(&r);
    let a = settings("breathe");
    for corrupt_key in [true, false] {
        let p = a.produce(&sample(2.13), 1920, 1080, &i, &r).unwrap();
        let mut shared = super::plan::Plan {
            commands: p.commands,
        };
        let Command::Surface { size, commands, .. } = &mut shared.commands[0] else {
            panic!("base")
        };
        if corrupt_key {
            let Command::PreparedPatch { patch_key, .. } = &mut commands[1] else {
                panic!("patch")
            };
            patch_key.push('x');
        } else {
            size[0] += 1;
        }
        assert!(
            shared
                .validate_surfaces(a.render_pixels(&i).unwrap())
                .is_err()
        );
    }
}

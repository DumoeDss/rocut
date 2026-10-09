//! Synthetic platform facts test native contract/order/budgets, not font pixels.
use super::{
    Sample,
    model::TitleRiff,
    plan::Command,
    producer,
    tests::{model, resources, sample},
};
use crate::{mv_font_metrics, mv_image_dimensions, programmatic_resources::Resource};
use serde_json::json;

fn font_facts(a: &TitleRiff, s: &Sample<'_>) -> mv_font_metrics::Context {
    let mut requests = Vec::new();
    a.sampled_requests(s, &resources(), &mut requests).unwrap();
    let measured=requests.iter().map(|r| {
        let bounds=r.bounds.iter().map(|b| {let mut v=serde_json::to_value(b).unwrap();
            v["left"]=json!(0);v["right"]=json!(if b.text.is_empty(){0.0}else{b.font_size_px*0.9});
            v["ascent"]=json!(if b.text.is_empty(){0.0}else{b.font_size_px*0.8});v["descent"]=json!(0);v}).collect::<Vec<_>>();
        let advances=r.advances.iter().map(|a|json!({"text":a.text,"fontSizePx":a.font_size_px,"letterSpacingPx":a.letter_spacing_px,
            "width":a.text.chars().count()as f64*a.font_size_px*0.6})).collect::<Vec<_>>();
        serde_json::from_value(json!({"resource":r.resource,"glyphs":[],"bounds":bounds,"advances":advances})).unwrap()
    }).collect::<Vec<mv_font_metrics::Measurement>>();
    mv_font_metrics::Context::new(&requests, &measured).unwrap()
}
fn image_facts(a: &TitleRiff, omit: Option<&str>) -> mv_image_dimensions::Context {
    let requests=a.images().iter().filter(|id|Some(**id)!=omit).map(|id|mv_image_dimensions::Request {resource:serde_json::from_value::<Resource>(json!({
        "id":id,"kind":"image","attachmentKey":format!("programmatic-resources/{}.png","b".repeat(64)),"mimeType":"image/png","byteLength":100,"sha256":"b".repeat(64)})).unwrap()}).collect::<Vec<_>>();
    let measured = requests
        .iter()
        .map(|r| mv_image_dimensions::Measurement {
            resource: r.resource.clone(),
            width: if r.resource.id == "character.png" {
                192
            } else {
                480
            },
            height: if r.resource.id == "character.png" {
                320
            } else {
                270
            },
        })
        .collect::<Vec<_>>();
    mv_image_dimensions::Context::new(&requests, &measured).unwrap()
}
#[test]
fn complete_native_intro_outro_emit_real_surfaces_images_monuments_and_explicit_lifetimes() {
    for (outro, time) in [
        (false, 4.03),
        (false, 5.46),
        (false, 6.071),
        (false, 9.13),
        (true, 22.96),
        (true, 25.13),
        (true, 29.5),
    ] {
        let a = model(outro);
        let s = sample(time, outro);
        let fonts = font_facts(&a, &s);
        let images = image_facts(&a, None);
        let plan = a.produce(&s, 1920, 1080, &fonts, &images).unwrap();
        let peak = plan.validate_surfaces(67_108_864).unwrap();
        let (commands, steps) = producer::work(&plan.commands);
        let json = serde_json::to_string(&plan).unwrap();
        eprintln!(
            "titleRiff outro={outro} time={time} commands={commands} steps={steps} scratchPixels={peak} jsonBytes={}",
            json.len()
        );
        if !outro && time == 6.071 {
            // Same worst-case frame as the original verbose transport failure:
            // 81576 expanded steps / 9022519 bytes / 69643322 modeled pixels.
            // Compression must preserve work and obey the unchanged total cap.
            let total = peak + 33_554_432 + 6 * 1920 * 1080 + (json.len() as u64 * 3 + 3) / 4;
            eprintln!("titleRiff worst-case conservativeTotalPixels={total} cap=67108864");
            assert_eq!(steps, 81576);
            assert!(json.len() < 9022519);
            assert!(
                total <= 67_108_864,
                "compressed transport must fit the same total admission model"
            );
        }
        assert!(steps > 1000 || time == 29.5);
        assert!(commands < producer::MAX_DRAW_COMMANDS);
        assert!(steps < producer::MAX_PATH_STEPS);
        assert!(json.contains("grayPixels"));
        assert!(json.contains("releaseSurface"));
        assert!(json.contains("title-front"));
        if time == 4.03 {
            assert!(json.contains("title-monument-0"));
            assert!(json.contains("\"fontSize\":1000.0"));
            assert!(json.contains("source-atop"));
        }
        if time == 9.13 {
            assert!(json.contains("title-sky-cutout"));
            assert!(json.contains("destination-in"));
            assert!(json.contains("title-rim"));
        }
        if outro && time == 22.96 {
            // First visual beat=20.5, current index=4; authored recap[4%3]
            // is sky. Before lock beat8 there are no contact-sheet panels.
            assert!(json.contains("sky.png"));
            assert!(!json.contains("dawn.png"));
        } else if outro {
            assert!(json.contains("dawn.png"));
        }
        let again = a.produce(&s, 1920, 1080, &fonts, &images).unwrap();
        assert_eq!(json, serde_json::to_string(&again).unwrap());
    }
}
#[test]
fn decoded_dependencies_are_preflighted_even_before_hidden_silhouette_or_recap_cues() {
    for (outro, time, id) in [(false, 2.25, "character.png"), (true, 20.25, "dawn.png")] {
        let a = model(outro);
        let s = sample(time, outro);
        let fonts = font_facts(&a, &s);
        let images = image_facts(&a, Some(id));
        assert!(a.produce(&s, 1920, 1080, &fonts, &images).is_err());
    }
}
#[test]
fn monument_scratch_copies_camera_ctm_before_local_glyph_transforms() {
    use super::plan::Operation;
    for (outro, time) in [(false, 4.03), (false, 6.5), (true, 22.03)] {
        let a = model(outro);
        let s = sample(time, outro);
        let plan = a
            .produce(&s, 1920, 1080, &font_facts(&a, &s), &image_facts(&a, None))
            .unwrap();
        let mut glyphs = 0;
        for command in &plan.commands {
            if let Command::Surface { id, commands, .. } = command {
                for draw in commands {
                    if let Command::Text {
                        operations,
                        font_size,
                        ..
                    } = draw
                    {
                        if id.starts_with("title-monument-") {
                            assert_eq!(*font_size, 1000.0);
                            assert!(matches!(
                                operations.as_slice(),
                                [
                                    Operation::Translate { .. },
                                    Operation::Scale { .. },
                                    Operation::Translate { .. },
                                    Operation::CopyTransform,
                                    Operation::Translate { .. },
                                    Operation::Scale { .. },
                                ]
                            ));
                            glyphs += 1;
                        } else if operations
                            .iter()
                            .any(|op| matches!(op, Operation::CopyTransform))
                        {
                            // At the alpha-zero silhouette entry the main canvas
                            // already exceeds its pin budget. Ring labels inherit
                            // the reconstructed camera; fixed-screen type does not.
                            assert_eq!(*id, "title-front");
                            assert!(!outro && time == 6.5);
                            assert_eq!(*font_size, 13.0);
                            assert!(matches!(
                                operations.as_slice(),
                                [
                                    Operation::Translate { .. },
                                    Operation::Scale { .. },
                                    Operation::Translate { .. },
                                    Operation::CopyTransform,
                                    Operation::Translate { .. },
                                    Operation::Rotate { .. },
                                ]
                            ));
                        }
                    }
                }
            }
        }
        assert!(glyphs >= 2, "must check both offset/body plates");
    }
}
#[test]
fn exact_current_frame_fonts_cannot_be_reused_for_a_different_live_hud_and_tracking() {
    let a = model(false);
    let first = sample(9.13, false);
    let next = sample(8.8, false);
    let fonts = font_facts(&a, &first);
    let images = image_facts(&a, None);
    assert!(a.produce(&next, 1920, 1080, &fonts, &images).is_err());
    let plan = a.produce(&first, 1920, 1080, &fonts, &images).unwrap();
    assert!(matches!(
        plan.commands.last(),
        Some(Command::ReleaseSurface {
            surface: "title-front"
        })
    ));
}

#[test]
fn reference_rectangle_outlines_and_full_frame_alpha_keep_their_canvas_primitive() {
    use super::plan::{PaintKind, Style};
    for (outro, time, expected_strokes) in [(false, 6.5, 4), (true, 25.133333333333333, 6)] {
        let a = model(outro);
        let s = sample(time, outro);
        let plan = a
            .produce(&s, 1920, 1080, &font_facts(&a, &s), &image_facts(&a, None))
            .unwrap();
        let strokes = plan.commands.iter().filter_map(|v| match v {
            Command::Surface { commands, .. } => Some(commands), _ => None,
        }).flatten().filter(|v| matches!(v, Command::Rect { paint, .. } if matches!(paint.kind, PaintKind::Stroke { .. }))).count();
        assert_eq!(
            strokes, expected_strokes,
            "strokeRect must not become a polygon stroke"
        );
    }
    for (outro, ticks, expected_composite) in [
        (true, 2_582_000, "lighter"),
        (false, 1_464_000, "source-over"),
    ] {
        let a = model(outro);
        let mut s = sample(0.0, outro);
        s.song_ticks = ticks;
        let plan = a
            .produce(&s, 1920, 1080, &font_facts(&a, &s), &image_facts(&a, None))
            .unwrap();
        let front = plan
            .commands
            .iter()
            .find_map(|v| match v {
                Command::Surface {
                    id: "title-front",
                    commands,
                    ..
                } => Some(commands),
                _ => None,
            })
            .unwrap();
        let Some(Command::Rect { paint, .. }) = front.last() else {
            panic!("missing full-frame accent")
        };
        assert_eq!(paint.composite, expected_composite);
        assert!(paint.opacity > 0.0 && paint.opacity < 1.0);
        let Style::Solid { color } = &paint.style else {
            panic!("accent must use solid ink")
        };
        assert_eq!(
            color[3], 1.0,
            "D.fill opacity is globalAlpha, not a CSS color channel"
        );
    }
}

use super::super::plan::{Command, Paint, PaintKind, Plan, Style};

fn surface(id: &'static str, size: [u32; 2], commands: Vec<Command>) -> Command {
    Command::Surface { id, size, commands }
}
fn pattern(source: &'static str) -> Command {
    Command::SurfacePatternRect {
        surface: source,
        rect: [0.0, 0.0, 10.0, 20.0],
        transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
        operations: vec![],
        clip: None,
        composite: "source-in",
        opacity: 0.7,
        smoothing: true,
        smoothing_quality: "low",
    }
}
fn alpha() -> Command {
    Command::AlphaPixels {
        size: [2, 2],
        alpha: vec![0, 7, 128, 255],
        position: [-3, 5],
    }
}
fn batch(count: usize) -> Command {
    Command::RectBatch {
        transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
        operations: vec![],
        clip: None,
        rects: vec![[1.25, 2.5, 1.0, 1.0]; count],
        paint: Paint {
            style: Style::Solid {
                color: [0.0, 0.0, 0.0, 0.35],
            },
            composite: "destination-out",
            opacity: 1.0,
            kind: PaintKind::Fill,
        },
    }
}
fn stroke() -> Command {
    Command::TextStroke {
        font: "font".into(),
        text: "壊".into(),
        font_size: 1500.0,
        tracking: 0.0,
        position: [105.0, 1205.0],
        transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
        operations: vec![],
        clip: None,
        style: Style::Solid { color: [1.0; 4] },
        width: 2.0,
        cap: "round",
        join: "round",
        blur_px: 2.0,
        raster_bounds: [0.0, 0.0, 10.0, 20.0],
        opacity: 0.7,
        composite: "lighter",
        align: "left",
        baseline: "alphabetic",
    }
}

#[test]
fn alpha_upload_charges_retained_payload_and_transient_bytes() {
    let plan = Plan {
        commands: vec![surface("a", [10, 20], vec![alpha()])],
    };
    assert_eq!(plan.validate_surfaces(444).unwrap(), 444);
    assert!(plan.validate_surfaces(443).is_err());
    for (size, bytes) in [([0, 2], vec![]), ([4097, 1], vec![]), ([2, 2], vec![1; 3])] {
        let plan = Plan {
            commands: vec![Command::AlphaPixels {
                size,
                alpha: bytes,
                position: [0, 0],
            }],
        };
        assert!(plan.validate_surfaces(u64::MAX).is_err());
    }
    let wire = serde_json::to_value(alpha()).unwrap();
    assert_eq!(wire["kind"], "alphaPixels");
    assert_eq!(wire["alpha"], serde_json::json!([0, 7, 128, 255]));
    assert!(wire.get("gray").is_none());
}

#[test]
fn future_payload_is_live_before_its_canvas_exists_and_after_release() {
    let plan = Plan {
        commands: vec![
            surface("large", [20, 20], vec![]),
            Command::ReleaseSurface { surface: "large" },
            surface("small", [10, 20], vec![alpha(), batch(2)]),
            Command::ReleaseSurface { surface: "small" },
        ],
    };
    // All retained bytes exist before rendering: 800 + 4*9 + 2*128.
    assert_eq!(plan.validate_surfaces(1092).unwrap(), 1092);
    assert!(plan.validate_surfaces(1091).is_err());
}

#[test]
fn patterns_reuse_only_completed_live_surfaces_without_new_allocations() {
    let plan = Plan {
        commands: vec![
            surface("a", [10, 20], vec![]),
            surface("b", [10, 20], vec![pattern("a")]),
            pattern("a"),
            pattern("b"),
        ],
    };
    assert_eq!(plan.validate_surfaces(800).unwrap(), 800);
    for commands in [
        vec![pattern("missing")],
        vec![surface("a", [10, 20], vec![pattern("a")])],
        vec![pattern("a"), surface("a", [10, 20], vec![])],
        vec![
            surface("a", [10, 20], vec![]),
            Command::ReleaseSurface { surface: "a" },
            pattern("a"),
        ],
    ] {
        assert!(Plan { commands }.validate_surfaces(u64::MAX).is_err());
    }
    let wire = serde_json::to_value(pattern("noise")).unwrap();
    assert_eq!(wire["kind"], "surfacePatternRect");
    assert_eq!(wire["smoothingQuality"], "low");
}

#[test]
fn text_stroke_filter_uses_explicit_native_bounds_and_keeps_fill_separate() {
    let plan = Plan {
        commands: vec![surface("a", [10, 20], vec![stroke()])],
    };
    assert_eq!(plan.validate_surfaces(1808).unwrap(), 1808);
    assert!(plan.validate_surfaces(1807).is_err());
    for (width, blur, bounds) in [
        (0.0, 0.0, [0.0, 0.0, 10.0, 20.0]),
        (2.0, 17.0, [0.0, 0.0, 10.0, 20.0]),
        (2.0, f64::NAN, [0.0, 0.0, 10.0, 20.0]),
        (2.0, 0.0, [0.0, 0.0, -1.0, 20.0]),
        (2.0, 2.0, [0.0, 0.0, 8192.0, 20.0]),
        (2.0, 0.0, [f64::INFINITY, 0.0, 10.0, 20.0]),
    ] {
        let mut command = stroke();
        if let Command::TextStroke {
            width: w,
            blur_px,
            raster_bounds,
            ..
        } = &mut command
        {
            *w = width;
            *blur_px = blur;
            *raster_bounds = bounds;
        }
        assert!(
            Plan {
                commands: vec![command]
            }
            .validate_surfaces(u64::MAX)
            .is_err()
        );
    }
    let wire = serde_json::to_value(stroke()).unwrap();
    assert_eq!(wire["kind"], "textStroke");
    assert_eq!(wire["blurPx"], 2.0);
    assert_eq!(
        wire["rasterBounds"],
        serde_json::json!([0.0, 0.0, 10.0, 20.0])
    );
    assert!(wire.get("color").is_none());
}

#[test]
fn rect_batch_work_and_payload_are_expanded_not_hidden_by_transport() {
    let plan = Plan {
        commands: vec![batch(20_000)],
    };
    assert_eq!(plan.validate_surfaces(2_560_000).unwrap(), 2_560_000);
    assert!(plan.validate_surfaces(2_559_999).is_err());
    assert!(
        Plan {
            commands: vec![batch(20_001)]
        }
        .validate_surfaces(u64::MAX)
        .is_err()
    );
    let mut invalid = batch(1);
    if let Command::RectBatch { paint, .. } = &mut invalid {
        paint.kind = PaintKind::Stroke {
            width: 1.0,
            cap: "round",
            join: "round",
        };
    }
    assert!(
        Plan {
            commands: vec![invalid]
        }
        .validate_surfaces(u64::MAX)
        .is_err()
    );
    let mut invalid = batch(1);
    if let Command::RectBatch { rects, .. } = &mut invalid {
        rects[0][0] = f64::NAN;
    }
    assert!(
        Plan {
            commands: vec![invalid]
        }
        .validate_surfaces(u64::MAX)
        .is_err()
    );
    let mut circles = batch(0);
    if let Command::RectBatch {
        transform,
        operations,
        clip,
        paint,
        ..
    } = circles
    {
        circles = Command::CircleBatch {
            transform,
            operations,
            clip,
            circles: vec![[0.0, 0.0, 1.0]; 49_998],
            paints: vec![paint],
        };
    }
    assert!(
        Plan {
            commands: vec![circles, batch(1)]
        }
        .validate_surfaces(u64::MAX)
        .is_err()
    );
}

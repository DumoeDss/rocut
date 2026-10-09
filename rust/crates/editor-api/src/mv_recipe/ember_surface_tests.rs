use super::super::plan::{Command, Plan, Style, TextFill};

fn surface(id: &'static str, commands: Vec<Command>) -> Command {
    Command::Surface {
        id,
        size: [10, 20],
        commands,
    }
}
fn blit(surface: &'static str) -> Command {
    Command::Blit {
        surface,
        source_rect: [0.0, 0.0, 10.0, 20.0],
        destination_rect: [0.0, 0.0, 10.0, 20.0],
        transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
        operations: vec![],
        composite: "source-in",
        opacity: 0.7,
        clip: None,
        raster: None,
    }
}
fn grain(size: [u32; 2], gray: Vec<u8>) -> Command {
    Command::Grain {
        transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
        rect: [0.0, 0.0, 10.0, 20.0],
        size,
        gray,
        opacity: 0.2,
        fill_history: None,
    }
}

#[test]
fn explicit_release_tracks_peak_retains_id_history_and_checks_all_readers() {
    let release = |surface| Command::ReleaseSurface { surface };
    let plan = Plan {
        commands: vec![
            surface("a", vec![]),
            surface("b", vec![blit("a")]),
            surface("c", vec![blit("a"), blit("b")]),
            release("a"),
            release("b"),
            surface("d", vec![blit("c")]),
            release("c"),
            blit("d"),
        ],
    };
    assert_eq!(plan.validate_surfaces(1200).unwrap(), 1200);
    assert!(plan.validate_surfaces(1199).is_err());
    for commands in [
        vec![release("missing")],
        vec![surface("a", vec![]), release("a"), blit("a")],
        vec![surface("a", vec![]), release("a"), surface("a", vec![])],
        vec![surface("a", vec![]), release("a"), release("a")],
        vec![surface("a", vec![]), surface("b", vec![release("a")])],
    ] {
        assert!(Plan { commands }.validate_surfaces(u64::MAX).is_err());
    }
}

#[test]
fn gray_pixels_and_filter_scratch_are_charged_and_invalid_raster_rejects() {
    use super::super::plan::BlitRaster;
    let pixels = |size, gray| Command::GrayPixels {
        size,
        gray,
        position: [0, 0],
    };
    let plan = Plan {
        commands: vec![surface("a", vec![pixels([2, 2], vec![128; 4])])],
    };
    assert_eq!(plan.validate_surfaces(444).unwrap(), 444);
    assert!(
        Plan {
            commands: vec![pixels([2, 2], vec![128; 3])]
        }
        .validate_surfaces(100)
        .is_err()
    );
    let mut filtered = blit("a");
    if let Command::Blit { raster, .. } = &mut filtered {
        *raster = Some(BlitRaster {
            blur_px: 2.0,
            smoothing: true,
            smoothing_quality: "low",
        });
    }
    let plan = Plan {
        commands: vec![surface("a", vec![]), filtered],
    };
    assert_eq!(plan.validate_surfaces(1808).unwrap(), 1808);
    let mut filtered = blit("a");
    if let Command::Blit { raster, .. } = &mut filtered {
        *raster = Some(BlitRaster {
            blur_px: f64::NAN,
            smoothing: true,
            smoothing_quality: "low",
        });
    }
    assert!(
        Plan {
            commands: vec![surface("a", vec![]), filtered]
        }
        .validate_surfaces(u64::MAX)
        .is_err()
    );
}

#[test]
fn releasing_canvas_cannot_release_owned_gray_payload_vectors() {
    let raw = || Command::GrayPixels {
        size: [2, 2],
        gray: vec![128; 4],
        position: [0, 0],
    };
    let plan = Plan {
        commands: vec![
            surface("a", vec![raw()]),
            Command::ReleaseSurface { surface: "a" },
            surface("b", vec![raw()]),
            Command::ReleaseSurface { surface: "b" },
        ],
    };
    // 400 live target + two retained 36-pixel payload allowances + 8 temp.
    assert_eq!(plan.validate_surfaces(480).unwrap(), 480);
    assert!(plan.validate_surfaces(479).is_err());
}

#[test]
fn ordered_diamond_counts_allocations_once_but_preserves_each_blit() {
    let plan = Plan {
        commands: vec![
            surface("paper", vec![grain([2, 2], vec![90; 4])]),
            surface("glyph", vec![blit("paper"), blit("paper")]),
            surface("masked", vec![blit("glyph"), blit("paper")]),
            blit("masked"),
            blit("masked"),
        ],
    };
    assert_eq!(plan.validate_surfaces(1208).unwrap(), 1208);
    assert!(plan.validate_surfaces(1207).is_err());
    let json = serde_json::to_value(&plan).unwrap();
    assert_eq!(json["commands"][1]["commands"].as_array().unwrap().len(), 2);
    assert_eq!(json["commands"][1]["commands"][0]["composite"], "source-in");
}

#[test]
fn self_forward_cycles_duplicates_and_nested_definitions_are_rejected() {
    let cases = vec![
        vec![blit("missing")],
        vec![surface("a", vec![blit("a")])],
        vec![surface("a", vec![blit("b")]), surface("b", vec![])],
        vec![surface("a", vec![blit("b")]), surface("b", vec![blit("a")])],
        vec![surface("a", vec![]), surface("a", vec![])],
        vec![surface("a", vec![surface("b", vec![])])],
        vec![surface("", vec![])],
    ];
    for commands in cases {
        assert!(Plan { commands }.validate_surfaces(u64::MAX).is_err());
    }
}

#[test]
fn grain_dimensions_lengths_and_repeated_private_allocations_are_charged() {
    for (size, gray) in [([0, 1], vec![]), ([4097, 1], vec![]), ([2, 2], vec![0; 3])] {
        assert!(
            Plan {
                commands: vec![grain(size, gray)]
            }
            .validate_surfaces(u64::MAX)
            .is_err()
        );
    }
    let plan = Plan {
        commands: vec![
            surface("a", vec![grain([2, 2], vec![0; 4])]),
            grain([2, 2], vec![0; 4]),
        ],
    };
    assert_eq!(plan.validate_surfaces(416).unwrap(), 416);
    assert!(plan.validate_surfaces(415).is_err());
    let oversized = Plan {
        commands: vec![Command::Surface {
            id: "bad",
            size: [4097, 1],
            commands: vec![],
        }],
    };
    assert!(oversized.validate_surfaces(u64::MAX).is_err());
}

#[test]
fn surface_and_command_limits_are_enforced_without_recursive_expansion() {
    let plan = Plan {
        commands: std::iter::once(surface("a", vec![]))
            .chain((0..4097).map(|_| blit("a")))
            .collect(),
    };
    assert!(plan.validate_surfaces(u64::MAX).is_err());
    let names: Vec<String> = (0..65).map(|i| format!("surface-{i}")).collect();
    // Production plan identifiers are scene-owned static symbols.
    let commands = names
        .into_iter()
        .map(|s| surface(Box::leak(s.into_boxed_str()), vec![]))
        .collect();
    assert!(Plan { commands }.validate_surfaces(u64::MAX).is_err());
}

#[test]
fn solid_text_wire_format_stays_unchanged_and_gradient_text_is_explicit() {
    let solid = serde_json::to_value(TextFill::Color { color: [1.0; 4] }).unwrap();
    assert!(solid.get("color").is_some());
    assert!(solid.get("style").is_none());
    let gradient = serde_json::to_value(TextFill::Style {
        style: Style::Linear {
            from: [0.0, 0.0],
            to: [10.0, 20.0],
            stops: vec![],
        },
    })
    .unwrap();
    assert_eq!(gradient["style"]["kind"], "linear");
    assert!(gradient.get("color").is_none());
}

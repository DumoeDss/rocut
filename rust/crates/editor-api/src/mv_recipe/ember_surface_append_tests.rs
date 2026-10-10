use super::super::plan::{BlitRaster, Command, Paint, PaintKind, Plan, Style};

fn surface(id: &'static str) -> Command {
    Command::Surface {
        id,
        size: [10, 20],
        commands: vec![],
    }
}
fn append(surface: &'static str, commands: Vec<Command>) -> Command {
    Command::AppendSurface { surface, commands }
}
fn release(surface: &'static str) -> Command {
    Command::ReleaseSurface { surface }
}
fn blit(surface: &'static str) -> Command {
    Command::Blit {
        surface,
        source_rect: [0.0, 0.0, 10.0, 20.0],
        destination_rect: [0.0, 0.0, 10.0, 20.0],
        transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
        operations: vec![],
        composite: "source-over",
        opacity: 0.7,
        clip: None,
        raster: None,
    }
}
fn pattern(surface: &'static str) -> Command {
    Command::SurfacePatternRect {
        surface,
        rect: [0.0, 0.0, 10.0, 20.0],
        transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
        operations: vec![],
        clip: None,
        composite: "source-over",
        opacity: 1.0,
        smoothing: true,
        smoothing_quality: "low",
    }
}
fn batch(count: usize) -> Command {
    Command::RectBatch {
        transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
        operations: vec![],
        clip: None,
        rects: vec![[0.0, 0.0, 1.0, 1.0]; count],
        paint: Paint {
            style: Style::Solid { color: [1.0; 4] },
            composite: "source-over",
            opacity: 1.0,
            kind: PaintKind::Fill,
        },
    }
}

#[test]
fn append_mutates_live_target_without_another_allocation_or_new_identity() {
    let plan = Plan {
        commands: vec![
            surface("source"),
            surface("target"),
            append("target", vec![blit("source"), pattern("source")]),
            release("source"),
            append("target", vec![]),
            blit("target"),
            release("target"),
        ],
    };
    assert_eq!(plan.validate_surfaces(800).unwrap(), 800);
    assert!(plan.validate_surfaces(799).is_err());
    let wire = serde_json::to_value(&plan).unwrap();
    assert_eq!(wire["commands"][2]["kind"], "appendSurface");
    assert!(wire["commands"][2].get("size").is_none());
}

#[test]
fn append_requires_live_target_and_forbids_self_future_released_or_nested_lifecycles() {
    let cases = vec![
        vec![append("", vec![])],
        vec![append("missing", vec![])],
        vec![append("future", vec![]), surface("future")],
        vec![surface("a"), release("a"), append("a", vec![])],
        vec![surface("a"), append("a", vec![blit("a")])],
        vec![surface("a"), append("a", vec![pattern("a")])],
        vec![
            surface("a"),
            append("a", vec![blit("future")]),
            surface("future"),
        ],
        vec![
            surface("a"),
            surface("b"),
            release("b"),
            append("a", vec![pattern("b")]),
        ],
        vec![surface("a"), append("a", vec![surface("child")])],
        vec![surface("a"), append("a", vec![release("a")])],
        vec![
            surface("a"),
            surface("b"),
            append("a", vec![append("b", vec![])]),
        ],
        vec![
            surface("a"),
            Command::Surface {
                id: "b",
                size: [1, 1],
                commands: vec![append("a", vec![])],
            },
        ],
        vec![
            surface("a"),
            append("a", vec![]),
            release("a"),
            surface("a"),
        ],
    ];
    for commands in cases {
        assert!(Plan { commands }.validate_surfaces(u64::MAX).is_err());
    }
}

#[test]
fn append_payload_is_retained_before_target_exists_and_after_release() {
    let plan = Plan {
        commands: vec![
            Command::Surface {
                id: "large",
                size: [20, 20],
                commands: vec![],
            },
            release("large"),
            surface("small"),
            append(
                "small",
                vec![
                    Command::AlphaPixels {
                        size: [2, 2],
                        alpha: vec![0; 4],
                        position: [0, 0],
                    },
                    batch(2),
                ],
            ),
            release("small"),
        ],
    };
    // The future append payload is already owned while the800px canvas lives.
    assert_eq!(plan.validate_surfaces(1092).unwrap(), 1092);
    assert!(plan.validate_surfaces(1091).is_err());
}

#[test]
fn append_filters_and_expanded_work_keep_the_same_limits() {
    let mut filtered = blit("source");
    if let Command::Blit { raster, .. } = &mut filtered {
        *raster = Some(BlitRaster {
            blur_px: 2.0,
            contrast: None,
            smoothing: true,
            smoothing_quality: "low",
        });
    }
    let plan = Plan {
        commands: vec![
            surface("source"),
            surface("target"),
            append("target", vec![filtered]),
        ],
    };
    assert_eq!(plan.validate_surfaces(2208).unwrap(), 2208);
    assert!(plan.validate_surfaces(2207).is_err());
    for children in [
        vec![batch(20_001)],
        (0..4096).map(|_| blit("source")).collect(),
    ] {
        assert!(
            Plan {
                commands: vec![
                    surface("source"),
                    surface("target"),
                    append("target", children)
                ]
            }
            .validate_surfaces(u64::MAX)
            .is_err()
        );
    }
}

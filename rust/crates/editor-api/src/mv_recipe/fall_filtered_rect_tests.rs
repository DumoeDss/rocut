use super::super::super::plan::{Paint, Plan, Stop};
use super::*;

fn command() -> Command {
    Command::FilteredRect {
        transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
        operations: vec![],
        clip: None,
        rect: [22.0, 20.0, 20.0, 472.0],
        blur_px: 10.0,
        paint: Paint {
            kind: PaintKind::Fill,
            composite: "source-over",
            opacity: 1.0,
            style: Style::Linear {
                from: [0.0, 0.0],
                to: [0.0, 512.0],
                stops: vec![
                    Stop {
                        offset: 0.0,
                        color: [1.0, 1.0, 1.0, 0.0],
                    },
                    Stop {
                        offset: 0.18,
                        color: [1.0; 4],
                    },
                    Stop {
                        offset: 1.0,
                        color: [1.0, 1.0, 1.0, 0.0],
                    },
                ],
            },
        },
    }
}
#[test]
fn filtered_rect_adds_filter_scratch_to_existing_target_lifetime() {
    // Existing tracker: two target backing/copy units; filter intermediates use
    // the same conservative six-sigma padded two-buffer allowance as blits.
    // This is logical accounting, not a claim about browser process RSS.
    assert_eq!(cost(&command()).unwrap(), 2 * (20 + 60) * (472 + 60));
    for release in [false, true] {
        let mut commands = vec![Command::Surface {
            id: "streak",
            size: [64, 512],
            commands: vec![command()],
        }];
        if release {
            commands.push(Command::ReleaseSurface { surface: "streak" });
        }
        let plan = Plan { commands };
        assert_eq!(plan.validate_surfaces(150656).unwrap(), 150656);
        assert!(plan.validate_surfaces(150655).is_err());
    }
    let wire = serde_json::to_value(command()).unwrap();
    assert_eq!(wire["kind"], "filteredRect");
    assert_eq!(wire["blurPx"], 10.0);
}
#[test]
fn append_retains_target_and_charges_only_peak_transient_filter_scratch() {
    let plan = Plan {
        commands: vec![
            Command::Surface {
                id: "streak",
                size: [64, 512],
                commands: vec![command()],
            },
            Command::AppendSurface {
                surface: "streak",
                commands: vec![command()],
            },
            Command::ReleaseSurface { surface: "streak" },
        ],
    };
    assert_eq!(plan.validate_surfaces(150656).unwrap(), 150656);
    assert!(plan.validate_surfaces(150655).is_err());
}
#[test]
fn identity_only_contract_rejects_unbounded_or_unsupported_input() {
    for case in 0..12 {
        let mut c = command();
        if let Command::FilteredRect {
            transform,
            operations,
            rect,
            paint,
            blur_px,
            clip,
        } = &mut c
        {
            match case {
                0 => transform[4] = 1.0,
                1 => operations.push(super::super::super::plan::Operation::CopyTransform),
                2 => *blur_px = f64::NAN,
                3 => *blur_px = 16.01,
                4 => *blur_px = -0.1,
                5 => rect[2] = 8192.0,
                6 => rect[0] = f64::INFINITY,
                7 => paint.opacity = 1.01,
                8 => paint.composite = "copy",
                9 => {
                    paint.kind = PaintKind::Stroke {
                        width: 1.0,
                        cap: "butt",
                        join: "miter",
                    }
                }
                10 => {
                    paint.style = Style::Solid {
                        color: [f64::NAN; 4],
                    }
                }
                _ => {
                    *clip = Some(super::super::super::plan::Clip {
                        transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
                        operations: vec![],
                        path: vec![],
                    })
                }
            }
        }
        assert!(cost(&c).is_err(), "accepted invalid case {case}");
    }
}
#[test]
fn zero_blur_and_negative_rect_extent_keep_native_fill_semantics() {
    let mut c = command();
    if let Command::FilteredRect { blur_px, rect, .. } = &mut c {
        *blur_px = 0.0;
        *rect = [42.0, 492.0, -20.0, -472.0];
    }
    assert_eq!(cost(&c).unwrap(), 0);
    if let Command::FilteredRect { blur_px, .. } = &mut c {
        *blur_px = 10.0;
    }
    assert_eq!(cost(&c).unwrap(), 85120);
}

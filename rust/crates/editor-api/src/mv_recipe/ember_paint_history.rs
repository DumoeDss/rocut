//! Admission for replay-only paint history. There is no author-controlled code
//! or new raster allocation; its entire native/JSON/JS payload stays retained.
use super::super::plan::{FillHistory, Style};
use crate::mv_recipe::validate::{color, range};

const MAX_STOPS: usize = 16;
// Same 32 pixel-equivalents per scalar as RectBatch's four-scalar allowance:
// f64 storage, bounded JSON and retained JS/transport copies. Fixed overhead
// covers the fixed schema keys/kind strings, object and vector headers.
const SCALAR_PAYLOAD_PIXELS: u64 = 32;
const FIXED_PAYLOAD_PIXELS: u64 = 64;

pub(super) fn payload(history: Option<&FillHistory>) -> Result<u64, String> {
    let Some(history) = history else {
        return Ok(0);
    };
    let geometry = |values: &[f64]| values.iter().all(|v| range(*v, -1_000_000.0, 1_000_000.0));
    if !geometry(&history.transform) {
        return Err("Paint history requires a bounded finite creation matrix".into());
    }
    let (coordinates, stops) = match &history.style {
        Style::Solid { color: value } => {
            if !color(value) {
                return Err("Paint history requires normalized finite color".into());
            }
            return Ok(FIXED_PAYLOAD_PIXELS + (6 + 4) * SCALAR_PAYLOAD_PIXELS);
        }
        Style::Linear { from, to, stops } => {
            if !geometry(from) || !geometry(to) {
                return Err("Paint history requires bounded finite gradient geometry".into());
            }
            (4, stops)
        }
        Style::Radial { from, to, stops } => {
            if !geometry(from)
                || !geometry(to)
                || !range(from[2], 0.0, 8192.0)
                || !range(to[2], 0.0, 8192.0)
            {
                return Err("Paint history requires bounded finite radial geometry".into());
            }
            (6, stops)
        }
    };
    if !(1..=MAX_STOPS).contains(&stops.len())
        || stops
            .iter()
            .any(|s| !range(s.offset, 0.0, 1.0) || !color(&s.color))
    {
        return Err("Paint history requires 1..16 normalized finite gradient stops".into());
    }
    Ok(FIXED_PAYLOAD_PIXELS + (6 + coordinates + 5 * stops.len() as u64) * SCALAR_PAYLOAD_PIXELS)
}

#[cfg(test)]
mod tests {
    use super::super::super::{
        draw::Draw,
        plan::{Command, Plan, Stop},
    };
    use super::*;

    fn history() -> FillHistory {
        FillHistory {
            transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
            style: Style::Radial {
                from: [960.0, 540.0, 378.0],
                to: [960.0, 540.0, 1134.0],
                stops: vec![
                    Stop {
                        offset: 0.0,
                        color: [0.0; 4],
                    },
                    Stop {
                        offset: 1.0,
                        color: [0.1, 0.2, 0.3, 0.45],
                    },
                ],
            },
        }
    }
    fn plan(history: Option<FillHistory>, release: bool) -> Plan {
        let mut commands = vec![Command::Surface {
            id: "paint",
            size: [2, 2],
            commands: vec![Command::Grain {
                transform: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
                rect: [0.0, 0.0, 2.0, 2.0],
                size: [2, 2],
                gray: vec![128; 4],
                opacity: 0.1,
                fill_history: history,
            }],
        }];
        if release {
            commands.push(Command::ReleaseSurface { surface: "paint" });
        }
        Plan { commands }
    }
    #[test]
    fn omitted_history_keeps_legacy_grain_wire_and_zero_extra_cost() {
        assert_eq!(payload(None).unwrap(), 0);
        for release in [false, true] {
            assert_eq!(plan(None, release).validate_surfaces(16).unwrap(), 16);
        }
        let mut draw = Draw::new(1920.0, 1080.0);
        draw.grain(
            [1.0, 0.0, 0.0, 1.0, -3.0, -4.0],
            [3.0, 4.0, 1920.0, 1080.0],
            vec![128; 65536],
            0.2,
        );
        let value = serde_json::to_value(&draw.commands[0]).unwrap();
        assert!(value.get("fillHistory").is_none());
        assert_eq!(
            value["transform"],
            serde_json::json!([1.0, 0.0, 0.0, 1.0, -3.0, -4.0])
        );
        assert_eq!(value["size"], serde_json::json!([256, 256]));
        assert_eq!(value["opacity"], 0.2);
    }
    #[test]
    fn complete_history_is_charged_in_sum_and_live_peak_before_release() {
        assert_eq!(payload(Some(&history())).unwrap(), 768);
        for release in [false, true] {
            let p = plan(Some(history()), release);
            assert_eq!(p.validate_surfaces(784).unwrap(), 784);
            assert!(p.validate_surfaces(783).is_err());
            let value = serde_json::to_value(&p).unwrap();
            assert_eq!(
                value["commands"][0]["commands"][0]["fillHistory"]["style"]["kind"],
                "radial"
            );
        }
        let mut p = plan(Some(history()), true);
        p.commands.push(Command::Surface {
            id: "later",
            size: [3, 3],
            commands: vec![],
        });
        assert_eq!(p.validate_surfaces(794).unwrap(), 794);
        assert!(p.validate_surfaces(793).is_err());
        let mut h = history();
        h.style = Style::Solid { color: [1.0; 4] };
        assert_eq!(payload(Some(&h)).unwrap(), 384);
        h.style = Style::Linear {
            from: [0.0, 0.0],
            to: [1.0, 1.0],
            stops: vec![Stop {
                offset: 0.0,
                color: [1.0; 4],
            }],
        };
        assert_eq!(payload(Some(&h)).unwrap(), 544);
    }
    #[test]
    fn malformed_history_is_rejected_by_both_admission_paths() {
        for release in [false, true] {
            for bad in [f64::NAN, f64::INFINITY, -f64::INFINITY, 1_000_001.0] {
                let mut h = history();
                h.transform[4] = bad;
                assert!(plan(Some(h), release).validate_surfaces(u64::MAX).is_err());
            }
            for index in 0..9 {
                let mut h = history();
                let Style::Radial { from, to, stops } = &mut h.style else {
                    unreachable!()
                };
                match index {
                    0 => from[0] = f64::NAN,
                    1 => to[1] = 1_000_001.0,
                    2 => from[2] = -1.0,
                    3 => to[2] = 8193.0,
                    4 => stops[0].offset = 1.1,
                    5 => stops[0].color[1] = f64::NAN,
                    6 => stops[0].color[3] = 1.1,
                    7 => stops.clear(),
                    _ => {
                        for _ in 0..15 {
                            stops.push(Stop {
                                offset: 0.5,
                                color: [0.0; 4],
                            });
                        }
                    }
                }
                assert!(plan(Some(h), release).validate_surfaces(u64::MAX).is_err());
            }
            let mut h = history();
            h.style = Style::Solid { color: [-0.1; 4] };
            assert!(plan(Some(h), release).validate_surfaces(u64::MAX).is_err());
            let mut h = history();
            h.style = Style::Linear {
                from: [0.0, f64::INFINITY],
                to: [1.0, 1.0],
                stops: vec![Stop {
                    offset: 0.0,
                    color: [1.0; 4],
                }],
            };
            assert!(plan(Some(h), release).validate_surfaces(u64::MAX).is_err());
        }
    }
}

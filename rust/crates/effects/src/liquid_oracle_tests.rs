use serde::Deserialize;

use crate::{
    liquid_replay,
    liquid_sim::{Config, Event, State},
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    version: u32,
    absolute_tolerance: f64,
    relative_tolerance: f64,
    cases: Vec<Case>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Case {
    name: String,
    input: Input,
    expected: Fields,
    #[serde(default)]
    negative_controls: Vec<Control>,
}

#[derive(Deserialize)]
struct Control {
    name: String,
    state: Fields,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Input {
    config: InputConfig,
    events: Vec<InputEvent>,
    elapsed_ticks: u64,
    width: u32,
    height: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InputConfig {
    columns: u32,
    rows: u32,
    viscosity: f64,
    velocity_damping: f64,
    dye_dissipation: f64,
    pressure_iterations: u32,
    diffusion_iterations: u32,
    vorticity: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InputEvent {
    at_ticks: u64,
    center: [f64; 2],
    radius: f64,
    velocity: [f64; 2],
    dye: f64,
}

#[derive(Deserialize)]
struct Fields {
    u: Vec<f64>,
    v: Vec<f64>,
    pressure: Vec<f64>,
    dye: Vec<f64>,
}

fn compare(actual: &State, expected: &Fields, absolute: f64, relative: f64) -> Result<f64, String> {
    let mut maximum: f64 = 0.0;
    for (field, actual, expected) in [
        ("u", actual.u(), expected.u.as_slice()),
        ("v", actual.v(), expected.v.as_slice()),
        ("pressure", actual.pressure(), expected.pressure.as_slice()),
        ("dye", actual.dye(), expected.dye.as_slice()),
    ] {
        if actual.len() != expected.len() {
            return Err(format!("{field} length mismatch"));
        }
        for (i, (&a, &e)) in actual.iter().zip(expected).enumerate() {
            let delta = (a - e).abs();
            if !a.is_finite() || !e.is_finite() || delta > absolute + relative * e.abs() {
                return Err(format!(
                    "{field}[{i}]: actual={a}, expected={e}, delta={delta}"
                ));
            }
            maximum = maximum.max(delta);
        }
    }
    Ok(maximum)
}

#[test]
fn frozen_independent_mac_oracle_and_three_fault_controls() {
    let fixture: Fixture = serde_json::from_str(include_str!("liquid-oracle-state.json")).unwrap();
    assert_eq!(fixture.version, 1);
    assert_eq!(fixture.cases.len(), 7);
    let mut rejected = 0;
    for case in fixture.cases {
        let c = &case.input.config;
        let config = Config {
            columns: c.columns,
            rows: c.rows,
            viscosity: c.viscosity,
            velocity_damping: c.velocity_damping,
            dye_dissipation: c.dye_dissipation,
            pressure_iterations: c.pressure_iterations,
            diffusion_iterations: c.diffusion_iterations,
            vorticity: c.vorticity,
        };
        let events: Vec<_> = case
            .input
            .events
            .iter()
            .map(|e| Event {
                at_ticks: e.at_ticks,
                center: e.center,
                radius: e.radius,
                velocity: e.velocity,
                dye: e.dye,
            })
            .collect();
        let actual = liquid_replay::simulate(
            &config,
            &events,
            [case.input.width, case.input.height],
            case.input.elapsed_ticks,
            240000,
            || false,
        )
        .unwrap();
        let maximum = compare(
            &actual,
            &case.expected,
            fixture.absolute_tolerance,
            fixture.relative_tolerance,
        )
        .unwrap_or_else(|error| panic!("{}: {error}", case.name));
        eprintln!("{} maximum state error: {maximum:e}", case.name);
        for control in case.negative_controls {
            assert!(
                compare(
                    &actual,
                    &control.state,
                    fixture.absolute_tolerance,
                    fixture.relative_tolerance
                )
                .is_err(),
                "{} failed to reject {}",
                case.name,
                control.name
            );
            rejected += 1;
        }
    }
    assert_eq!(rejected, 3);
}

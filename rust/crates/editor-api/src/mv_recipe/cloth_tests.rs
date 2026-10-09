use super::*;
use crate::mv_recipe::replay::{ReplayError, ReplayModel, ReplayStep};
use serde_json::json;

fn settings() -> Cloth {
    serde_json::from_value(json!({
        "image":"image", "rect":[0,0,1,1], "fit":"contain",
        "columns":4,"rows":4,"pins":"topEdge","gravity":1.5,
        "wind":[0.3,0,0.8],"gust":0.4,"gustFrequency":0.8,"damping":2,
        "stretchCompliance":0.000001,"bendCompliance":0.001,
        "solverIterations":6,"perspective":0.6,"shading":0.45,"opacity":1,"events":[]
    }))
    .unwrap()
}

fn resource() -> Resource {
    serde_json::from_value(json!({"id":"image","kind":"image","mimeType":"image/png",
        "byteLength":1,"sha256":"ab".repeat(32),
        "attachmentKey":format!("programmatic-sha256-{}","ab".repeat(32))}))
    .unwrap()
}

fn zero_forces() -> Cloth {
    let mut s = settings();
    s.gravity = 0.0;
    s.wind = [0.0; 3];
    s.gust = 0.0;
    s.damping = 0.0;
    s
}

fn step(index: u64) -> ReplayStep {
    ReplayStep {
        index,
        start_ticks: index * STEP_TICKS,
        end_ticks: (index + 1) * STEP_TICKS,
    }
}

#[test]
fn zero_force_is_exactly_flat_stationary_and_initial_state_is_seed_independent() {
    let s = zero_forces();
    let r = resource();
    let model = model::Model::new(&s, 3, 640, 360, &r).unwrap();
    let other = model::Model::new(&s, 65, 640, 360, &r).unwrap();
    let initial = model.initialize().unwrap();
    assert_eq!(initial, other.initialize().unwrap());
    let output = replay(&model, 120_000, budget(), None, || false).unwrap();
    assert_eq!(output.checkpoint.state().points, initial.points);
    assert!(output.checkpoint.state().lambdas.iter().all(|v| *v == 0.0));
    assert!(s.plan(0, 3, 640, 360, &r).unwrap().full_image);
    let positive = s.plan(1, 3, 640, 360, &r).unwrap();
    assert!(!positive.full_image);
    assert_eq!(positive.faces.len(), 32);
}

#[test]
fn structural_shear_and_two_edge_bending_have_unique_rest_constraints() {
    let s = settings();
    let constraints = constraints::build(&s, [2.0, 1.0]);
    assert_eq!(constraints.len(), 102);
    let mut pairs = std::collections::HashSet::new();
    for c in constraints {
        assert!(pairs.insert((c.a.min(c.b), c.a.max(c.b))));
        assert_eq!(
            c.rest,
            constraints::length(constraints::sub(
                constraints::rest(&s, [2.0, 1.0], c.a),
                constraints::rest(&s, [2.0, 1.0], c.b)
            ))
        );
    }
    assert_eq!(constraints::count(12, 8), 594);
    assert_eq!(constraints::count(24, 24), 3502);
}

#[test]
fn xpbd_accumulates_lambda_within_step_and_preserves_pins() {
    let mut s = zero_forces();
    s.stretch_compliance = 0.0001;
    let model = model::Model::new(&s, 1, 100, 100, &resource()).unwrap();
    let mut state = model.initialize().unwrap();
    let constraint = *model
        .constraints
        .iter()
        .find(|c| c.a == 5 && c.b == 6)
        .unwrap();
    state.points[constraint.b].position[0] += 0.1;
    let mut lambda = 0.0;
    constraints::solve(&s, &mut state.points, constraint, &mut lambda);
    let alpha = s.stretch_compliance / (DT * DT);
    assert!((lambda + 0.1 / (2.0 + alpha)).abs() < 1e-14);
    let expected_error = 0.1 * alpha / (2.0 + alpha);
    for _ in 0..10 {
        constraints::solve(&s, &mut state.points, constraint, &mut lambda);
    }
    let distance = constraints::length(constraints::sub(
        state.points[5].position,
        state.points[6].position,
    ));
    assert!((distance - constraint.rest - expected_error).abs() < 1e-14);
    let pinned = *model
        .constraints
        .iter()
        .find(|c| c.a == 0 && c.b == 5)
        .unwrap();
    let before = state.points[0].position;
    state.points[5].position[1] += 0.2;
    constraints::solve(&s, &mut state.points, pinned, &mut 0.0);
    assert_eq!(state.points[0].position, before);
}

#[test]
fn lambda_resets_each_step_and_all_pin_modes_stay_exact() {
    for pins in [Pins::TopEdge, Pins::TopCorners, Pins::LeftEdge] {
        let mut s = settings();
        s.pins = pins;
        s.events.push(Event {
            at_ticks: 0,
            center: [0.5, 0.5],
            radius: 2.0,
            velocity: [3.0, -3.0, 3.0],
        });
        let model = model::Model::new(&s, 4, 640, 360, &resource()).unwrap();
        let mut normal = model.initialize().unwrap();
        let mut stale = normal.clone();
        stale.lambdas.fill(42.0);
        model.advance(&mut normal, step(0)).unwrap();
        model.advance(&mut stale, step(0)).unwrap();
        assert_eq!(normal, stale);
        let output = replay(&model, 240_000, budget(), None, || false).unwrap();
        for (i, p) in output.checkpoint.state().points.iter().enumerate() {
            if s.pinned(i) {
                assert_eq!(p.position, constraints::rest(&s, model.size, i));
                assert_eq!(p.velocity, [0.0; 3]);
            }
        }
    }
}

#[test]
fn event_interval_is_start_inclusive_end_exclusive_and_floor_stepped() {
    let mut s = zero_forces();
    s.events.push(Event {
        at_ticks: 1_000,
        center: [0.5, 1.0],
        radius: 0.2,
        velocity: [0.0, 0.0, 1.0],
    });
    let model = model::Model::new(&s, 1, 100, 100, &resource()).unwrap();
    let before = replay(&model, 1_999, budget(), None, || false).unwrap();
    assert_eq!(before.position.completed_steps, 1);
    assert_eq!(before.position.remainder_ticks, 999);
    assert_eq!(before.checkpoint.state().event_cursor, 0);
    assert_eq!(
        before.checkpoint.state().points,
        model.initialize().unwrap().points
    );
    let after = replay(&model, 2_000, budget(), Some(&before.checkpoint), || false).unwrap();
    assert_eq!(after.checkpoint.state().event_cursor, 1);
    assert!(after.checkpoint.state().points[22].position[2] > 0.0);
    s.events[0].at_ticks = 999;
    let earlier = model::Model::new(&s, 1, 100, 100, &resource()).unwrap();
    assert_eq!(
        replay(&earlier, 1_000, budget(), None, || false)
            .unwrap()
            .checkpoint
            .state()
            .event_cursor,
        1
    );
}

#[test]
fn checkpoints_and_reverse_requests_match_cold_replay_exactly() {
    let s = settings();
    let model = model::Model::new(&s, 19, 640, 360, &resource()).unwrap();
    let first = replay(&model, 47_399, budget(), None, || false).unwrap();
    let resumed = replay(&model, 123_987, budget(), Some(&first.checkpoint), || false).unwrap();
    let cold = replay(&model, 123_987, budget(), None, || false).unwrap();
    assert_eq!(resumed.checkpoint.state(), cold.checkpoint.state());
    let reverse = replay(&model, 47_399, budget(), None, || false).unwrap();
    assert_eq!(first.checkpoint.state(), reverse.checkpoint.state());
    let changed_seed = model::Model::new(&s, 20, 640, 360, &resource()).unwrap();
    assert!(matches!(
        replay(
            &changed_seed,
            123_987,
            budget(),
            Some(&first.checkpoint),
            || false
        ),
        Err(ReplayError::CheckpointIdentity)
    ));
    let changed_size = model::Model::new(&s, 19, 360, 640, &resource()).unwrap();
    assert!(matches!(
        replay(
            &changed_size,
            123_987,
            budget(),
            Some(&first.checkpoint),
            || false
        ),
        Err(ReplayError::CheckpointIdentity)
    ));
    let mut changed = s.clone();
    changed.opacity = 0.5;
    let changed_settings = model::Model::new(&changed, 19, 640, 360, &resource()).unwrap();
    assert!(matches!(
        replay(
            &changed_settings,
            123_987,
            budget(),
            Some(&first.checkpoint),
            || false
        ),
        Err(ReplayError::CheckpointIdentity)
    ));
}

#[test]
fn non_square_event_radius_uses_short_side_units_and_authored_impulse_order() {
    let mut s = zero_forces();
    s.events.push(Event {
        at_ticks: 0,
        center: [0.5, 0.5],
        radius: 1.0,
        velocity: [0.0, 0.0, 1.0],
    });
    let model = model::Model::new(&s, 0, 200, 100, &resource()).unwrap();
    let mut state = model.initialize().unwrap();
    model.apply_events(&mut state, step(0)).unwrap();
    assert_eq!(state.points[12].velocity[2], 1.0);
    assert_eq!(state.points[13].velocity[2], 0.5);
    assert_eq!(state.points[22].velocity[2], 0.5);
    assert_eq!(state.points[17].velocity[2], 0.84375);
    assert_eq!(state.points[14].velocity[2], 0.0);
    assert_eq!(state.points[2].velocity[2], 0.0);
    s.events = [3.0, 2e-16, -3.0]
        .map(|x| Event {
            at_ticks: 0,
            center: [0.5, 0.5],
            radius: 1.0,
            velocity: [x, 0.0, 0.0],
        })
        .to_vec();
    let authored = model::Model::new(&s, 0, 200, 100, &resource()).unwrap();
    let mut a = authored.initialize().unwrap();
    authored.apply_events(&mut a, step(0)).unwrap();
    assert_eq!(a.points[12].velocity[0], 0.0);
    s.events.swap(1, 2);
    let reordered = model::Model::new(&s, 0, 200, 100, &resource()).unwrap();
    let mut b = reordered.initialize().unwrap();
    reordered.apply_events(&mut b, step(0)).unwrap();
    assert_eq!(b.points[12].velocity[0], 2e-16);
}

#[test]
fn admission_and_memory_are_bounded_before_simulation() {
    let mut s = settings();
    s.solver_iterations = 12;
    assert_eq!(s.sim_work(MAX_DURATION), Some(6_000_982));
    assert!(s.valid_duration(MAX_DURATION));
    assert!(!s.valid_duration(0));
    assert!(!s.valid_duration(MAX_DURATION + 1));
    s.columns = 24;
    s.rows = 24;
    assert!(!s.valid_duration(MAX_DURATION));
    assert!(s.plan(MAX_DURATION, 0, 640, 360, &resource()).is_err());
    assert!(s.valid_duration(STEP_TICKS));
    let model = model::Model::new(&s, 0, 640, 360, &resource()).unwrap();
    let mut limited = budget();
    limited.max_state_bytes = 1;
    assert!(matches!(
        replay(&model, 0, limited, None, || false),
        Err(ReplayError::MemoryLimit)
    ));
    assert!(replay(&model, 1_000, budget(), None, || false).is_ok());
    s.events.push(Event {
        at_ticks: 1_000,
        center: [0.5, 0.5],
        radius: 1.0,
        velocity: [0.0; 3],
    });
    assert!(!s.valid_duration(1_000));
    assert!(s.valid_duration(1_001));
    s.columns = 0;
    assert!(s.sim_work(1_000).is_none());
    assert!(model::Model::new(&s, 0, 640, 360, &resource()).is_err());
}

#[test]
fn near_camera_clipping_preserves_valid_polygons_without_moving_physics() {
    let s = settings();
    let model = model::Model::new(&s, 0, 100, 100, &resource()).unwrap();
    let mut state = model.initialize().unwrap();
    state.points[12].position[2] = 20.0;
    let original = state.clone();
    let plan = mesh::plan(&model, &state, false);
    assert_eq!(state, original);
    assert!(plan.faces.iter().any(|face| face.vertices.len() == 4));
    let mut triangles = 0;
    for face in plan.faces {
        assert!((3..=4).contains(&face.vertices.len()));
        triangles += face.vertices.len() - 2;
        for v in face.vertices {
            assert!(v.w >= 0.05);
            assert!(v.position.iter().all(|n| n.is_finite()));
            assert!(v.uv.iter().all(|n| (0.0..=1.0).contains(n)));
        }
    }
    assert!(triangles <= s.work() as usize);
}

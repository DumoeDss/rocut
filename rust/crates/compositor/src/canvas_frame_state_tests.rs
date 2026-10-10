use super::*;
use serde_json::{Value, json};
use std::collections::BTreeMap;

fn frame(count: usize) -> crate::FrameDescriptor {
    let catalog: Vec<Value> =
        serde_json::from_str(&effects::stylized_effect_catalog_json()).unwrap();
    let definition = catalog.iter().find(|d| d["id"] == "canvas").unwrap();
    let parameters: BTreeMap<_, _> = definition["fields"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|f| f["required"] == true)
        .map(|f| (f["key"].as_str().unwrap(), f["default"].as_f64().unwrap()))
        .collect();
    let resolved: Value = serde_json::from_str(&effects::resolve_stylized_effect_json(
        json!({
            "effectType":"canvas","params":parameters,"localTime":4000,
            "frameRate":{"numerator":30,"denominator":1}
        })
        .to_string(),
    ))
    .unwrap();
    let item = json!({"type":"sceneEffect","effectPassGroups":[[resolved["passes"][0].clone()]]});
    serde_json::from_value(
        json!({"width":2,"height":2,"clear":{"color":[0,0,0,0]},"items":vec![item;count]}),
    )
    .unwrap()
}
fn prepared(count: usize) -> PreparedFrame {
    crate::prepared_frame::FramePreparation::new(frame(count))
        .unwrap()
        .complete()
        .unwrap()
}
fn ticket(frame: &PreparedFrame) -> CanvasCaptureTicket {
    let mut cursor = frame.traversal_cursor().unwrap();
    for entry in &frame.canvas.entries {
        match cursor.next(&entry.position, &entry.pass).unwrap() {
            FrameTraversalPass::NeedCapture(ticket) => return ticket,
            FrameTraversalPass::Canvas(_) => (),
            _ => panic!("Canvas fixture"),
        }
    }
    panic!("missing ticket")
}
fn complete_one(frame: &mut PreparedFrame) {
    let capture = ticket(frame);
    frame
        .begin_canvas_preparation(capture, vec![0; 16])
        .unwrap();
    while frame.canvas_minimum_step_work().is_some() {
        let quota = frame.canvas_minimum_step_work().unwrap();
        frame.advance_canvas(quota).unwrap();
    }
}
#[test]
fn tickets_reject_foreign_out_of_order_duplicate_and_wrong_length() {
    let mut first = prepared(2);
    let second = prepared(1);
    assert!(
        first
            .begin_canvas_preparation(ticket(&second), vec![0; 16])
            .is_err()
    );
    let initial = ticket(&first);
    assert!(
        first
            .begin_canvas_preparation(initial.clone(), vec![0; 15])
            .is_err()
    );
    let mut forged = initial.clone();
    forged.ordinal = 1;
    assert!(first.begin_canvas_preparation(forged, vec![0; 16]).is_err());
    first
        .begin_canvas_preparation(initial.clone(), vec![0; 16])
        .unwrap();
    assert!(
        first
            .begin_canvas_preparation(initial.clone(), vec![0; 16])
            .is_err()
    );
    while let Some(quota) = first.canvas_minimum_step_work() {
        first.advance_canvas(quota).unwrap();
    }
    assert!(
        first
            .begin_canvas_preparation(initial, vec![0; 16])
            .is_err()
    );
    assert!(!first.canvas_ready());
    complete_one(&mut first);
    first.finalize_canvas().unwrap();
}
#[test]
fn traversal_is_position_and_bit_exact_and_repeatable() {
    let mut frame = prepared(2);
    assert!(frame.finalize_canvas().is_err());
    complete_one(&mut frame);
    complete_one(&mut frame);
    for _ in 0..3 {
        let mut cursor = frame.traversal_cursor().unwrap();
        for entry in &frame.canvas.entries {
            match cursor.next(&entry.position, &entry.pass).unwrap() {
                FrameTraversalPass::Canvas(p) => {
                    assert!(std::ptr::eq(p, entry.prepared.as_ref().unwrap()))
                }
                _ => panic!("ready Canvas"),
            }
        }
        cursor.finish().unwrap();
    }
    let entry = &frame.canvas.entries[0];
    let mut altered = entry.pass.clone();
    if let UniformValue::Vector(words) = altered.uniforms.get_mut("seed").unwrap() {
        words[0] = f32::from_bits(words[0].to_bits() ^ 1);
    }
    assert!(
        frame
            .traversal_cursor()
            .unwrap()
            .next(&entry.position, &altered)
            .is_err()
    );
    assert!(
        frame
            .traversal_cursor()
            .unwrap()
            .next(&frame.canvas.entries[1].position, &entry.pass)
            .is_err()
    );
    assert!(frame.traversal_cursor().unwrap().finish().is_err());
}
#[test]
fn real_capture_capacity_is_admitted_transactionally_before_replay() {
    let mut frame = prepared(1);
    let ticket = ticket(&frame);
    let mut oversized = Vec::with_capacity(effects::MAX_CANVAS_PREPARATION_BYTES as usize + 1);
    oversized.resize(16, 0);
    assert!(frame.begin_canvas_preparation(ticket, oversized).is_err());
    assert!(frame.canvas.active.is_none());
    assert_eq!(frame.canvas.entries[0].capacity, 16);
    complete_one(&mut frame);
    assert!(frame.canvas_ready());
}
#[test]
fn too_small_work_quota_preserves_pending_job() {
    let mut frame = prepared(1);
    frame
        .begin_canvas_preparation(ticket(&frame), vec![0; 16])
        .unwrap();
    let minimum = frame.canvas_minimum_step_work().unwrap();
    assert!(minimum.get() > 1);
    let before = frame.canvas.active.as_ref().unwrap().1.progress();
    assert!(frame.advance_canvas(NonZeroU64::new(1).unwrap()).is_err());
    assert_eq!(frame.canvas.active.as_ref().unwrap().1.progress(), before);
    assert!(!frame.canvas_ready());
}
#[test]
fn non_canvas_identity_borrows_frozen_descriptor_without_native_slots() {
    let mut descriptor = frame(0);
    descriptor
        .items
        .push(crate::FrameItemDescriptor::SceneEffect {
            effect_pass_groups: vec![vec![crate::EffectPassDescriptor {
                shader: "ordinary-fixture".into(),
                uniforms: [(
                    "exact".into(),
                    crate::frame::EffectUniformValueDescriptor::Number(-0.0),
                )]
                .into_iter()
                .collect(),
            }]],
        });
    let prepared = crate::prepared_frame::FramePreparation::new(descriptor)
        .unwrap()
        .complete()
        .unwrap();
    assert!(prepared.canvas.entries.is_empty());
    assert_eq!(prepared.canvas.total_passes, 1);
    let mut cursor = prepared.traversal_cursor().unwrap();
    crate::effect_positions::visit_passes(&prepared.frame, |position, pass| {
        let native = crate::compositor::map_effect_passes(std::slice::from_ref(pass)).remove(0);
        assert!(matches!(
            cursor.next(&position, &native).unwrap(),
            FrameTraversalPass::Ordinary
        ));
        let mut altered = native;
        altered
            .uniforms
            .insert("exact".into(), UniformValue::Number(0.0));
        assert!(
            prepared
                .traversal_cursor()
                .unwrap()
                .next(&position, &altered)
                .is_err()
        );
    });
    cursor.finish().unwrap();
}
#[test]
fn liquid_fixed_metadata_is_not_exempt_from_request_limit() {
    let mut descriptor = frame(0);
    descriptor
        .items
        .push(crate::FrameItemDescriptor::SceneEffect {
            effect_pass_groups: vec![vec![crate::EffectPassDescriptor {
                shader: "liquid".into(),
                uniforms: Default::default(),
            }]],
        });
    assert!(CanvasFrameState::new(&descriptor, effects::LIQUID_REQUEST_MEMORY_LIMIT).is_err());
}
#[test]
fn canvas_metadata_is_rejected_before_native_slot_cloning() {
    assert!(
        CanvasFrameState::new(
            &frame(1),
            crate::canvas_capture_budget::MAX_CANVAS_FRAME_BYTES
        )
        .is_err()
    );
    assert!(CanvasFrameState::new(&frame(65), 0).is_err());
}
#[test]
fn cursor_shape_rejects_count_capacity_and_overflow_boundaries() {
    use super::identity::validate_cursor_shape;
    assert!(validate_cursor_shape(0, [0, 0], [0, 0, 0]).is_ok());
    assert!(validate_cursor_shape(2, [2, 2], [2, 2, 2]).is_ok());
    assert!(validate_cursor_shape(2, [1, 2], [2, 2, 2]).is_err());
    assert!(validate_cursor_shape(2, [2, 3], [2, 2, 2]).is_err());
    for capacities in [[3, 2, 2], [2, 3, 2], [2, 2, 3], [1, 2, 2]] {
        assert!(validate_cursor_shape(2, [2, 2], capacities).is_err());
    }
    assert!(validate_cursor_shape(usize::MAX, [usize::MAX; 2], [usize::MAX; 3]).is_err());
}
#[test]
fn cursor_constructor_returns_errors_instead_of_panicking_on_stale_count() {
    let mut prepared = prepared(2);
    prepared.canvas.total_passes = 1;
    assert!(prepared.traversal_cursor().is_err());
    prepared.canvas.total_passes = 3;
    assert!(prepared.traversal_cursor().is_err());
    prepared.canvas.total_passes = 2;
    assert!(prepared.traversal_cursor().is_ok());
}
#[test]
fn borrowed_cursor_identity_order_matches_nested_branch_visitor() {
    let mut descriptor = frame(2);
    if let crate::FrameItemDescriptor::SceneEffect { effect_pass_groups } = &mut descriptor.items[1]
    {
        effect_pass_groups[0][0].uniforms.insert(
            "seed".into(),
            crate::frame::EffectUniformValueDescriptor::Vector(
                (0..4)
                    .map(|i| ((24f64.to_bits() >> (16 * i)) & 65535) as f32)
                    .collect(),
            ),
        );
    }
    let branch = crate::IsolatedGroupDescriptor {
        items: descriptor.items.clone(),
        opacity: 0.0,
        blend_mode: crate::BlendMode::Normal,
        effect_pass_groups: vec![],
    };
    descriptor.items = vec![crate::FrameItemDescriptor::SceneTransition(Box::new(
        crate::SceneTransitionDescriptor {
            outgoing: branch.clone(),
            incoming: branch,
            progress: 0.0,
        },
    ))];
    let mut prepared = crate::prepared_frame::FramePreparation::new(descriptor)
        .unwrap()
        .complete()
        .unwrap();
    assert_eq!(prepared.canvas.total_passes, 4);
    for _ in 0..4 {
        complete_one(&mut prepared);
    }
    for _ in 0..2 {
        let mut cursor = prepared.traversal_cursor().unwrap();
        crate::effect_positions::visit_passes(&prepared.frame, |position, pass| {
            let native = crate::compositor::map_effect_passes(std::slice::from_ref(pass)).remove(0);
            assert!(matches!(
                cursor.next(&position, &native).unwrap(),
                FrameTraversalPass::Canvas(_)
            ));
        });
        cursor.finish().unwrap();
    }
}

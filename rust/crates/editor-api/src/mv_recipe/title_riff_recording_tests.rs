use super::{DESIGN_SIZE, Operation, REFERENCE_PIN_LIMIT_BYTES, Recording};

fn camera() -> Vec<Operation> {
    vec![
        Operation::Translate {
            offset: [960.0, 540.0],
        },
        Operation::Scale {
            factors: [1.023, 1.023],
        },
        Operation::Translate {
            offset: [-953.7, -541.2],
        },
    ]
}

fn copies(operations: &[Operation]) -> Vec<usize> {
    operations
        .iter()
        .enumerate()
        .filter_map(|(i, op)| matches!(op, Operation::CopyTransform).then_some(i))
        .collect()
}

fn intro(monuments: usize, mask: Option<[u32; 2]>) -> Recording {
    let mut recording = Recording::new();
    recording.surface("paper", 0, DESIGN_SIZE).unwrap();
    recording.access();
    recording.save(&camera());
    for generation in 0..monuments {
        recording.save_identity();
        recording
            .surface("monument-scratch", generation as u64, DESIGN_SIZE)
            .unwrap();
        recording.restore();
    }
    recording.save(&[]);
    if let Some(size) = mask {
        for _ in 0..5 {
            recording.save(&[]);
            recording.surface("rim", 0, size).unwrap();
            recording.restore();
        }
        recording.save(&[]);
        recording.surface("sky-cutout", 0, size).unwrap();
        recording.restore();
    }
    recording.surface("half", 0, DESIGN_SIZE).unwrap();
    recording
}

#[test]
fn intro_counts_actual_layouts_unique_masks_and_a_strict_32_mib_boundary() {
    for monuments in 0..=2 {
        for mask in [
            None,
            Some([184, 255]),
            Some([184, 256]),
            Some([184, 257]),
            Some([192, 320]),
        ] {
            let mut recording = intro(monuments, mask);
            let expected = (monuments as u64 + 2) * 1920 * 1080 * 4
                + mask.map_or(0, |[w, h]| 2 * u64::from(w) * u64::from(h) * 4);
            assert_eq!(recording.bytes, expected);
            assert!(
                copies(&recording.operations()).is_empty(),
                "the draw itself does not flush"
            );
            recording.restore();
            assert_eq!(
                copies(&recording.operations()),
                if expected > REFERENCE_PIN_LIMIT_BYTES {
                    vec![3]
                } else {
                    vec![]
                }
            );
            recording.restore();
            assert!(
                recording.operations().is_empty(),
                "screen-fixed drawing stays identity"
            );
        }
    }
    assert_eq!(intro(2, Some([184, 256])).bytes, REFERENCE_PIN_LIMIT_BYTES);
}

#[test]
fn alpha_zero_has_no_discount_and_repeated_versions_pin_once_until_a_flush() {
    // There is no opacity discount: Chromium pins alpha-zero drawImage too.
    let mut recording = Recording::new();
    recording.save(&camera());
    for _ in 0..5 {
        recording.surface("rim", 0, DESIGN_SIZE).unwrap();
    }
    assert_eq!(recording.bytes, 1920 * 1080 * 4);
    for generation in 1..5 {
        recording.surface("rim", generation, DESIGN_SIZE).unwrap();
    }
    assert!(recording.bytes > REFERENCE_PIN_LIMIT_BYTES);
    recording.access();
    assert_eq!(recording.bytes, 0);
    assert!(recording.pinned.is_empty());
    assert_eq!(copies(&recording.operations()), [3]);
    recording.surface("rim", 0, DESIGN_SIZE).unwrap();
    assert_eq!(
        recording.bytes,
        1920 * 1080 * 4,
        "released references can pin again"
    );
}

#[test]
fn nested_flush_reconstructs_original_double_scope_not_prior_copied_prefix() {
    let mut recording = intro(2, Some([192, 320]));
    recording.restore();
    let local = [
        Operation::Translate {
            offset: [91.25, 42.75],
        },
        Operation::Scale {
            factors: [0.94, 0.94],
        },
    ];
    recording.save(&local);
    assert_eq!(copies(&recording.operations()), [3]);
    let created_clip = recording.operations();
    for generation in 0..5 {
        recording
            .surface("large-panel", generation, DESIGN_SIZE)
            .unwrap();
    }
    recording.access();
    assert_eq!(
        copies(&recording.operations()),
        [5],
        "only the nearest reconstructed scope is copied"
    );
    assert_eq!(
        copies(&created_clip),
        [3],
        "existing clips retain their creation-time matrix"
    );
    recording.transform(Operation::Rotate { radians: 0.007 });
    assert_eq!(copies(&recording.operations()), [5]);
    recording.restore();
    assert_eq!(
        copies(&recording.operations()),
        [3],
        "parent scopes are independently reconstructed"
    );
    recording.restore();
    assert!(recording.operations().is_empty());
}

#[test]
fn a_large_admitted_mask_can_flush_at_its_restore_before_halftone() {
    let mut recording = Recording::new();
    recording.surface("paper", 0, DESIGN_SIZE).unwrap();
    recording.save(&camera());
    for generation in 0..2 {
        recording.save_identity();
        recording
            .surface("monument-scratch", generation, DESIGN_SIZE)
            .unwrap();
        recording.restore();
    }
    recording.save(&[]);
    let clip = recording.operations();
    recording.save(&[Operation::Translate {
        offset: [23.0, 45.0],
    }]);
    recording.surface("rim", 0, [2048, 1536]).unwrap();
    assert!(copies(&recording.operations()).is_empty());
    recording.restore();
    assert_eq!(copies(&recording.operations()), [3]);
    assert!(copies(&clip).is_empty());
    assert_eq!(recording.bytes, 0);
}

#[test]
fn identity_scope_flush_restores_saved_camera_and_sources_are_namespaced() {
    let mut recording = Recording::new();
    recording.save(&camera());
    recording.save_identity();
    recording.surface("same-id", 0, DESIGN_SIZE).unwrap();
    recording.resource("same-id", DESIGN_SIZE).unwrap();
    assert_eq!(recording.pinned.len(), 2);
    for generation in 1..4 {
        recording
            .surface("same-id", generation, DESIGN_SIZE)
            .unwrap();
    }
    recording.access();
    assert!(recording.operations().is_empty());
    recording.restore();
    assert_eq!(copies(&recording.operations()), [3]);
}

#[test]
fn source_byte_overflow_or_inconsistent_generation_is_rejected() {
    let mut recording = Recording::new();
    assert!(
        recording
            .resource("overflow", [u32::MAX, u32::MAX])
            .is_err()
    );
    assert_eq!(recording.bytes, 0);
    recording.resource("stable", [1, 2]).unwrap();
    assert!(recording.resource("stable", [1, 3]).is_err());
    assert_eq!(recording.bytes, 8);
}

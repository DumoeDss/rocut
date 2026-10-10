use super::*;

#[test]
fn publication_binary_extraction_retries_failed_copy_then_consumes_once() {
    let owner = Owner::new().unwrap();
    let ticket = owner.reserve(1024).unwrap();
    let payload =
        memories::plan::raster("binding", "part".into(), [1, 1], vec![1, 2, 3, 4]).unwrap();
    let mut output = Output::new(
        Identity {
            owner_id: owner.id,
            session_id: 1,
        },
        1,
        memories::plan::Plan {
            commands: vec![],
            raster_budget_bytes: 0,
        },
        vec![payload],
        ticket.lease.clone(),
    )
    .unwrap();
    assert!(output
        .bytes(0, |_| -> Result<(), String> {
            Err("native upload rejected".into())
        })
        .is_err());
    assert_eq!(output.remaining(), 1);
    assert_eq!(
        output.bytes(0, |b| Ok(b.to_vec())).unwrap(),
        vec![1, 2, 3, 4]
    );
    assert_eq!(output.remaining(), 0);
    assert!(output.bytes(0, |_| Ok(())).is_err());
}

#[test]
fn reservation_is_retained_by_opaque_output_after_owner_disposal() {
    let mut owner = Owner::new().unwrap();
    let ticket = owner.reserve(1024).unwrap();
    let lease = ticket.lease.clone();
    let output = Output::new(
        Identity {
            owner_id: owner.id,
            session_id: 1,
        },
        1,
        memories::plan::Plan {
            commands: vec![],
            raster_budget_bytes: 0,
        },
        vec![],
        lease.clone(),
    )
    .unwrap();
    drop(ticket);
    owner.dispose();
    assert_eq!(Arc::strong_count(&lease), 2);
    drop(output);
    assert_eq!(Arc::strong_count(&lease), 1);
    assert!(owner.reserve(1).is_err());
}

#[test]
fn malformed_metadata_never_invokes_binary_copy() {
    let mut owner = Owner::new().unwrap();
    let result = owner.prepare_with("{}", 0, 0, || -> Result<(Vec<u8>, Vec<u8>), String> {
        panic!("invalid admission copied binary packets")
    });
    assert!(result.is_err());
}

#[test]
fn binary_ranges_reject_overflow_and_truncation() {
    assert!(Range {
        offset: usize::MAX,
        length: 2
    }
    .bytes(&[])
    .is_err());
    assert!(Range {
        offset: 1,
        length: 2
    }
    .bytes(&[1, 2])
    .is_err());
    assert_eq!(
        Range {
            offset: 1,
            length: 1
        }
        .bytes(&[1, 2])
        .unwrap(),
        &[2]
    );
}

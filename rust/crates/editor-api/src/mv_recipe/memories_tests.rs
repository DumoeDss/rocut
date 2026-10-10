use super::*;
fn resource(id: &str, weight: Option<u32>) -> Resource {
    let mut value = serde_json::json!({"id":id,"kind":if weight.is_some(){"font"}else{"image"},"attachmentKey":format!("programmatic-sha256-{}", "a".repeat(64)),"mimeType":if weight.is_some(){"font/woff2"}else{"image/png"},"byteLength":16,"sha256":"a".repeat(64)});
    if let Some(weight) = weight {
        value["font"] =
            serde_json::json!({"family":"Memories Fixture","weight":weight,"style":"normal"});
    }
    serde_json::from_value(value).unwrap()
}
fn input() -> (model::Args, Vec<Resource>, NativeFacts) {
    let image = resource("photo.png", None);
    let caption = resource("caption.woff2", Some(600));
    let date = resource("date.woff2", Some(400));
    let args = serde_json::from_value(serde_json::json!({"photos":[{"bg":"photo.png","caption":"あ😀"}],"captionFont":"caption.woff2","dateFont":"date.woff2"})).unwrap();
    let facts = NativeFacts {
        images: vec![ImageFact {
            resource: image.clone(),
            width: 20,
            height: 20,
        }],
        caption: FontFact {
            resource: caption.clone(),
            size: 40.0,
            weight: 600,
            widths: [("あ".into(), 40.0), ("😀".into(), 40.0)]
                .into_iter()
                .collect(),
        },
        date: FontFact {
            resource: date.clone(),
            size: 22.0,
            weight: 400,
            widths: [("4.17".into(), 42.0)].into_iter().collect(),
        },
    };
    (args, vec![image, caption, date], facts)
}
fn session() -> Session {
    let (a, r, f) = input();
    Session::prepare(a, r, f, 256 * 1024 * 1024).unwrap()
}
#[test]
fn font_metadata_and_scalar_metrics_are_admitted_before_fields() {
    let (a, r, mut f) = input();
    f.caption.widths.remove("😀");
    assert!(Session::prepare(a, r, f, 256 * 1024 * 1024)
        .err()
        .unwrap()
        .contains("Unicode scalar"));
    let (a, r, mut f) = input();
    f.date.widths.clear();
    assert!(Session::prepare(a, r, f, 256 * 1024 * 1024)
        .err()
        .unwrap()
        .contains("full-string"));
    let (a, mut r, mut f) = input();
    let bad = resource("caption.woff2", Some(500));
    r[1] = bad.clone();
    f.caption.resource = bad;
    assert!(Session::prepare(a, r, f, 256 * 1024 * 1024)
        .err()
        .unwrap()
        .contains("normal font"));
    let (a, r, mut f) = input();
    f.images.push(ImageFact {
        resource: r[0].clone(),
        width: 20,
        height: 20,
    });
    assert!(Session::prepare(a, r, f, 256 * 1024 * 1024).is_err());
}
#[test]
fn capabilities_are_single_flight_cross_owner_bound_and_cancelable() {
    let mut a = session();
    let mut b = session();
    assert!(a.composite_plan(0).is_err());
    assert!(a.print_plan(0).is_err());
    let stage = a.lut_plan().unwrap();
    assert!(stage.plan.raster_budget_bytes > 0);
    assert_eq!(stage.readback.dimensions(), [256, 1]);
    assert_eq!(stage.readback.plan_sha256().len(), 64);
    assert!(a.desk_plan().is_err());
    assert!(b.accept_lut(stage.readback, &vec![255; 1024]).is_err());
    // A foreign capability does not clear the pending owner stage.
    assert!(a.lut_plan().is_err());
    let stage = b.lut_plan().unwrap();
    b.cancel_stage(stage.readback).unwrap();
    let stage = b.lut_plan().unwrap();
    b.accept_lut(stage.readback, &vec![255; 1024]).unwrap();
    assert!(b.lut_plan().is_err());
    let stage = b.composite_plan(0).unwrap();
    b.cancel_stage(stage.readback).unwrap();
    assert!(b.composite_plan(0).is_ok());
}
#[test]
fn each_native_stage_has_a_real_joint_budget_and_complete_frame_producer() {
    let mut s = session();
    let lut = s.lut_plan().unwrap();
    s.accept_lut(lut.readback, &vec![255; 1024]).unwrap();
    let composite = s.composite_plan(0).unwrap();
    assert!(composite.plan.raster_budget_bytes >= s.stage.reserved + 1040 * 650 * 40);
    let graded = s
        .accept_composite(0, composite.readback, &vec![255; 1040 * 650 * 4])
        .unwrap();
    assert_eq!(graded.raster.width, 1040);
    let print = s.print_plan(0).unwrap();
    assert!(print.plan.raster_budget_bytes > s.stage.reserved + 1120 * 862 * 40);
    let retired = s
        .accept_print(0, print.readback, &vec![255; 1120 * 862 * 4])
        .unwrap();
    assert!(retired == graded.raster);
    assert!(s.photos[0].graded.is_none());
    assert!(s.print_plan(0).is_err());
    assert!(s.composite_plan(0).is_err());
    let desk = s.desk_plan().unwrap();
    assert_eq!(desk.payloads.len(), 1);
    assert!(desk.plan.raster_budget_bytes > s.stage.reserved + 1200 * 675 * 40);
    s.accept_desk(desk.readback, &vec![255; 1200 * 675 * 4])
        .unwrap();
    assert!(s.desk_plan().is_err());
    assert_eq!(s.prepared().unwrap().len(), 2);
    let beats: Vec<u64> = (0..20).map(|i| i * 60000).collect();
    for tick in [0, 60000, 240000, 480001, 720000] {
        let frame = s
            .frame(&Sample {
                song_ticks: tick,
                shot_start_ticks: 0,
                shot_end_ticks: 720000,
                beats: &beats,
                bpm: 120.0,
                downbeat_index: 0,
                resources: &s.resources,
            })
            .unwrap();
        assert!(
            frame.plan.raster_budget_bytes > 0
                && frame.plan.raster_budget_bytes <= 256 * 1024 * 1024
        );
    }
}
#[test]
fn stage_limit_precedes_native_allocation_and_bad_lengths_fail_closed() {
    let mut s = session();
    s.stage.limit = s.stage.reserved + 1024;
    assert!(s.lut_plan().is_err());
    assert!(s.stage.idle().is_ok());
    let mut s = session();
    let lut = s.lut_plan().unwrap();
    assert!(s.accept_lut(lut.readback, &[0; 4]).is_err());
    assert!(s.stage.idle().is_err());
    assert!(s.stage.lut.is_none());
}

#[test]
fn four_photo_frame_producer_reuses_only_released_surfaces() {
    let (mut a, r, mut f) = input();
    a.photos = vec![a.photos[0].clone(); 4];
    for date in model::DATES {
        f.date.widths.insert(date.into(), 42.0);
    }
    let mut s = Session::prepare(a, r, f, 256 * 1024 * 1024).unwrap();
    let lut = s.lut_plan().unwrap();
    s.accept_lut(lut.readback, &vec![255; 1024]).unwrap();
    for slot in 0..4 {
        let composite = s.composite_plan(slot).unwrap();
        s.accept_composite(slot, composite.readback, &vec![255; 1040 * 650 * 4])
            .unwrap();
        let print = s.print_plan(slot).unwrap();
        s.accept_print(slot, print.readback, &vec![255; 1120 * 862 * 4])
            .unwrap();
    }
    let desk = s.desk_plan().unwrap();
    s.accept_desk(desk.readback, &vec![255; 1200 * 675 * 4])
        .unwrap();
    let beats: Vec<u64> = (0..32).map(|i| i * 60000).collect();
    for tick in [240000, 480001, 600000, 719999] {
        let frame = s
            .frame(&Sample {
                song_ticks: tick,
                shot_start_ticks: 0,
                shot_end_ticks: 720000,
                beats: &beats,
                bpm: 120.0,
                downbeat_index: 0,
                resources: &s.resources,
            })
            .unwrap();
        assert!(frame.plan.raster_budget_bytes <= 256 * 1024 * 1024);
    }
}

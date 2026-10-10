use super::{
    Sample,
    clock::Clock,
    model::Ink,
    network::Network,
    paths::MAIN,
    plan::{Command, Operation},
};
use crate::{
    mv_image_dimensions::{self, Context},
    mv_recipe::model::Span,
    programmatic_resources::Resource,
};
use serde_json::{Value, json};
fn author() -> Value {
    json!({"char":"character","bpm":120,"downbeatIndex0":0,"beats":{"kind":"manual","songTicks":(0..40).map(|i|i*60000).collect::<Vec<_>>()}})
}
fn settings() -> Ink {
    serde_json::from_value(author()).unwrap()
}
fn sample(time: u64) -> Sample<'static> {
    Sample {
        shot_start_ticks: 480000,
        shot_end_ticks: 1200000,
        song_ticks: time,
        analysis: None,
    }
}
fn resources() -> Vec<Resource> {
    serde_json::from_value(json!([{"id":"character","kind":"image","mimeType":"image/png","sha256":"a".repeat(64),"byteLength":100,"attachmentKey":format!("programmatic-sha256-{}","a".repeat(64))}])).unwrap()
}
fn facts(w: u32, h: u32) -> Context {
    let resources = resources();
    let requests = mv_image_dimensions::requests(&resources, &["character"]).unwrap();
    Context::new(
        &requests,
        &[serde_json::from_value(json!({"resource":resources[0],"width":w,"height":h})).unwrap()],
    )
    .unwrap()
}
#[test]
fn real_recipe_admission_charges_measured_character_and_rejects_oversized_scratch() {
    let recipe: crate::mv_recipe::Recipe = serde_json::from_value(json!({
        "version":1,"root":"ink","songStartSeconds":4,"outputRoles":["subject"],
        "nodes":[{"id":"ink","scene":{"kind":"ink","role":"subject","settings":author(),
            "span":{"startFrame":0,"durationFrames":360}}}]
    }))
    .unwrap();
    let resources = resources();
    assert!(
        recipe
            .validate(&resources, 360, 1920, 1080, 2000)
            .is_empty()
    );
    let requests = recipe.image_dimension_requests(&resources).unwrap();
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].resource.id, "character");
    for dimensions in [[480, 960], [720, 1200]] {
        let images = facts(dimensions[0], dimensions[1]);
        recipe
            .check_with_images(&resources, 360, 1920, 1080, 2000, Some(&images))
            .unwrap();
    }
    let oversized = facts(4096, 4096);
    assert!(
        recipe
            .check_with_images(&resources, 360, 1920, 1080, 2000, Some(&oversized))
            .is_err()
    );
}
#[test]
fn public_frame_discovery_and_native_resolution_require_exact_image_identity() {
    let mut request = json!({"source":{"version":1,"runtime":"canvas-worker","code":"","width":1920,"height":1080,
        "frameRate":{"numerator":60,"denominator":1},"durationFrames":360,"seed":17,"resources":resources(),
        "recipe":{"version":1,"root":"ink","songStartSeconds":4,"outputRoles":["subject"],
            "nodes":[{"id":"ink","scene":{"kind":"ink","role":"subject","settings":author(),
                "span":{"startFrame":0,"durationFrames":360}}}]}},
        "clipStart":0,"clipDuration":720000,"trimStart":0,"timelineTime":360000});
    let resolve = |value: &Value| -> Value {
        serde_json::from_str(&crate::programmatic::resolve_programmatic_frame_json(
            value.to_string(),
        ))
        .unwrap()
    };
    let pending = resolve(&request);
    assert!(pending.get("error").is_none(), "{pending}");
    assert!(pending["frame"].get("recipePlan").is_none());
    assert_eq!(
        pending["frame"]["imageDimensionRequests"][0]["resource"],
        request["source"]["resources"][0]
    );
    request["imageDimensions"] =
        json!([{"resource":request["source"]["resources"][0],"width":480,"height":960}]);
    let ready = resolve(&request);
    assert!(ready.get("error").is_none(), "{ready}");
    assert_eq!(ready["frame"]["recipePlan"]["root"]["kind"], "ink");
    request["imageDimensions"][0]["resource"]["sha256"] = json!("b".repeat(64));
    assert!(resolve(&request).get("error").is_some());
}
#[test]
fn production_seed_time_matrix_keeps_plan_and_live_scratch_within_admission() {
    let images = facts(480, 960);
    let mut max_bytes = 0;
    let mut max_live = 0;
    for seed in [0, 7, 19, 1, u32::MAX] {
        let mut a = settings();
        a.seed = seed;
        let admitted = a.scratch_pixels(Some(&images)).unwrap();
        for ticks in [480000, 490000, 900000, 1198000] {
            let plan = a.produce(&sample(ticks), 1920, 1080, &images).unwrap();
            let bytes = serde_json::to_vec(&plan).unwrap().len();
            let live = plan.validate_surfaces(admitted).unwrap();
            max_bytes = max_bytes.max(bytes);
            max_live = max_live.max(live);
            assert!(bytes <= 1024 * 1024);
            assert!(live <= admitted);
        }
    }
    eprintln!(
        "Ink actual matrix: max serialized bytes={max_bytes}, max live scratch pixels={max_live}, admitted={}",
        settings().scratch_pixels(Some(&images)).unwrap()
    );
}
#[test]
fn zero_seed_and_authored_defaults_keep_original_contract() {
    let mut a = settings();
    assert_eq!(a.seed, 7);
    assert_eq!([a.h, a.x, a.y], [880., 960., 992.]);
    a.seed = 0;
    assert_eq!(a.network_seed(), 7);
    for key in ["landmarks", "palette", "disableFog", "sourceSeed"] {
        let mut v = author();
        v[key] = json!(0);
        assert!(serde_json::from_value::<Ink>(v).is_err());
    }
    assert!(a.valid(
        480000,
        &Span {
            start_frame: 0,
            duration_frames: 360
        },
        2000
    ));
}
#[test]
fn full_rate_clock_is_independent_of_quantized_growth_and_breathe() {
    let a = settings();
    let c0 = Clock::new(&a, &sample(480000)).unwrap();
    let c1 = Clock::new(&a, &sample(482000)).unwrap();
    let c5 = Clock::new(&a, &sample(490000)).unwrap();
    assert_eq!(c0.quantized, c1.quantized);
    assert_eq!(c0.ink_time, c1.ink_time);
    assert_ne!(c0.time, c1.time);
    assert_ne!(c0.progress, c1.progress);
    assert_eq!(c5.quantized, 4. + 1. / 12.);
    let mut offset = a;
    offset.downbeat_index0 = 3;
    assert_eq!(
        Clock::new(&offset, &sample(720000)).unwrap().ink_time,
        Clock::new(&settings(), &sample(720000)).unwrap().ink_time
    );
}
#[test]
fn empty_and_nonmonotonic_beats_fail_not_fake_or_zero_drawing() {
    for beats in [json!([]), json!([0, 0]), json!([60000, 0])] {
        let mut v = author();
        v["beats"]["songTicks"] = beats;
        let a: Ink = serde_json::from_value(v).unwrap();
        assert!(Clock::new(&a, &sample(480000)).is_err());
    }
    let mut v = author();
    v["beats"] = json!({"kind":"analysis","bogus":1});
    assert!(serde_json::from_value::<Ink>(v).is_err());
}
#[test]
fn nine_main_paths_and_complete_network_pool_helix_are_retained() {
    assert_eq!(MAIN.len(), 9);
    let net = Network::new(7);
    assert_eq!(net.pools.len(), 21);
    assert!(net.tendrils.len() >= 28 && net.tendrils.len() <= 37);
    let coil = net.tendrils.last().unwrap();
    assert_eq!(coil.seed, 99.);
    assert!(coil.points.len() > 161);
    let front = coil.front.as_ref().unwrap();
    assert_eq!(front.len(), coil.points.len());
    assert!(front.iter().any(|v| *v));
    assert!(front.iter().any(|v| !*v));
    let repeat = Network::new(7);
    assert_eq!(repeat.pools, net.pools);
    assert_ne!(Network::new(19).pools, net.pools);
}
#[test]
fn producer_layers_primitives_dimensions_and_reverse_repeats_are_explicit() {
    let a = settings();
    let images = facts(480, 960);
    let p = a.produce(&sample(900000), 1920, 1080, &images).unwrap();
    let bytes = serde_json::to_vec(&p).unwrap();
    assert_eq!(
        bytes,
        serde_json::to_vec(&a.produce(&sample(900000), 1920, 1080, &images).unwrap()).unwrap()
    );
    let surfaces: Vec<_> = p
        .commands
        .iter()
        .filter_map(|c| {
            if let Command::Surface { id, size, .. } = c {
                Some((*id, *size))
            } else {
                None
            }
        })
        .collect();
    for entry in [
        ("ik-pool-a", [510, 300]),
        ("ik-back-ha", [960, 540]),
        ("ik-back-qa", [480, 270]),
        ("ik-rim", [480, 960]),
    ] {
        assert!(surfaces.contains(&entry));
    }
    let changed = a
        .produce(&sample(900000), 1920, 1080, &facts(720, 1200))
        .unwrap();
    assert_ne!(bytes, serde_json::to_vec(&changed).unwrap());
    let bg = p
        .commands
        .iter()
        .find_map(|c| {
            if let Command::Surface {
                id: "ik-scene",
                commands,
                ..
            } = c
            {
                Some(commands)
            } else {
                None
            }
        })
        .unwrap();
    assert!(bg.iter().any(|c| matches!(c, Command::GradientRect { .. })));
    let pools = p
        .commands
        .iter()
        .find_map(|c| {
            if let Command::Surface {
                id: "ik-pool-a",
                commands,
                ..
            } = c
            {
                Some(commands)
            } else {
                None
            }
        })
        .unwrap();
    assert!(pools.iter().any(|c|matches!(c,Command::Path{operations,..} if operations.iter().any(|op|matches!(op,Operation::CopyScaledTransform{scale:0.25,offset:[60.0,60.0]})))));
}

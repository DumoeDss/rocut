// Standalone std-only CPU check; does not compile the workspace or WASM.
#[path = "../../rust/crates/editor-api/src/mv_recipe/ink_math.rs"]
mod math;
#[path = "../../rust/crates/editor-api/src/mv_recipe/ink_network.rs"]
mod network;
#[path = "../../rust/crates/editor-api/src/mv_recipe/ink_paths.rs"]
mod paths;
#[path = "../../rust/crates/editor-api/src/mv_recipe/converge_math.rs"]
mod seeded;
#[path = "../../rust/crates/editor-api/src/mv_recipe/ink_shape.rs"]
mod shape;
mod plan {
    #[derive(Debug)]
    pub enum Step {
        MoveTo { point: [f64; 2] },
        LineTo { point: [f64; 2] },
        Close,
    }
}
#[test]
fn seeded_network_keeps_all_authored_paths_and_reproducible_pools() {
    let n = network::Network::new(7);
    assert_eq!(n.pools.len(), 21);
    assert_eq!(paths::MAIN.len(), 9);
    assert_eq!(n.pools, network::Network::new(7).pools);
    assert_ne!(n.pools, network::Network::new(19).pools);
    let coil = n.tendrils.last().unwrap();
    assert_eq!(coil.points.len(), coil.front.as_ref().unwrap().len());
    for tn in &n.tendrils {
        assert!(tn.points.iter().flatten().all(|v| v.is_finite()));
        assert!(tn.duration > 0.);
    }
}
#[test]
fn full_network_retains_front_back_paths_under_existing_admission() {
    for seed in [7, 19, 1, 0xffffffff] {
        let n = network::Network::new(seed);
        let mut back = vec![];
        let mut front = vec![];
        for tn in &n.tendrils {
            shape::append(&mut back, tn, 10., false);
            shape::append(&mut front, tn, 10., true);
        }
        for step in back.iter().chain(&front) {
            if let plan::Step::MoveTo { point } | plan::Step::LineTo { point } = step {
                assert!(point.iter().all(|v| v.is_finite()));
            }
        }
        println!(
            "seed={seed} tendrils={} fullPathSteps={}",
            n.tendrils.len(),
            back.len() + front.len()
        );
        assert!(!front.is_empty());
        assert!(back.len() > front.len());
        assert!(back.len() + front.len() <= 12000);
    }
}

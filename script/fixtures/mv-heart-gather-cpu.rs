#[path = "../../rust/crates/editor-api/src/mv_recipe/heart_gather_motion.rs"]
mod gather;
fn main() {
    let candidates: Vec<_> = (0..32)
        .map(|index| gather::Candidate {
            index,
            coverage: ((index * 7) % 11 + 1) as f64,
        })
        .collect();
    let beats = [0.0, 0.49, 1.01, 1.54, 2.02, 2.57];
    for (t0, t1) in [(0.0, 2.2), (1.5, 3.8), (4.0, 6.0)] {
        let plan = gather::plan(&candidates, 24, &beats, 0.51, t0, t1).unwrap();
        for q in plan {
            println!("{} {} {:.17} {:.17} {:.17} {:.17} {} {:.17} {:.17} {:.17} {:.17} {:.17} {:.17} {} {:.17}",q.shard,q.k,q.at,q.duration,q.angle,q.radius,u8::from(q.far),q.side,q.bend,q.size,q.spin,q.flip,q.flip_velocity,u8::from(q.to_hand),q.random);
        }
    }
}

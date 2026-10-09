#[path = "../../rust/crates/editor-api/src/mv_recipe/heart_shards.rs"]
mod shards;
fn main() {
    let body = shards::components::prepare(20, 20, &vec![255; 20 * 20 * 4], 100_000).unwrap();
    let glass = shards::build(&body, 1_000_000).unwrap();
    println!(
        "{} {:.17} {:.17}",
        glass.shards.len(),
        glass.radius_max,
        glass.distance_max
    );
    for s in glass.shards {
        println!("{:.17} {:.17} {:.17} {:.17} {:.17} {:.17} {:.17} {:.17} {:.17} {:.17} {:.17} {:.17} {:.17} {:.17} {:.17} {:.17} {:.17}",
            s.pivot[0],s.pivot[1],s.coverage,s.distance,s.direction[0],s.direction[1],s.random,s.size,
            s.amplitude,s.velocity,s.spin_amplitude,s.spin_velocity,s.axis,s.flip_amplitude,s.flip_velocity,s.z,s.glow_phase);
        for tau in [0.0, 0.066, 0.067, 0.2, 1.5] {
            let p = s.position(tau, 0.0);
            println!("{:.17} {:.17}", p[0], p[1]);
        }
    }
}

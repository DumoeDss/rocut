#[path = "../../rust/crates/editor-api/src/mv_recipe/heart_sky_geometry.rs"]
mod geometry;
#[path = "../../rust/crates/editor-api/src/mv_recipe/heart_sky_night_data.rs"]
mod night;
fn main() {
    for (seed, ix, iy) in [(3913, 1150.0, 300.0), (7201, 960.0, 540.0), (0, 90.0, 70.0)] {
        let pieces = geometry::build(seed, [ix, iy]).unwrap();
        let sky = night::build(seed);
        println!(
            "{} {} {:.17} {:.17}",
            pieces.len(),
            sky.twinkles.len(),
            ix + 140.0,
            iy + 140.0
        );
        for p in pieces {
            println!("{:.17} {:.17} {} {:.17} {:.17} {:.17} {:.17} {:.17} {:.17} {:.17} {:.17} {:.17} {:.17} {:.17} {:.17} {:.17} {:.17} {:.17} {} {:.17} {:.17} {:.17} {} {}",p.position[0],p.position[1],p.ring,p.distance,p.near,p.direction[0],p.direction[1],p.angle,p.size,p.gravity,p.velocity[0],p.velocity[1],p.spin_velocity,p.spin_acceleration,p.axis,p.flip_velocity,p.glow_phase,p.jitter,u8::from(p.foreground),p.z,p.origin[0],p.origin[1],p.sprite_size[0],p.sprite_size[1]);
        }
        for s in sky.twinkles {
            println!(
                "{:.17} {:.17} {:.17} {:.17} {:.17} {}",
                s.position[0],
                s.position[1],
                s.radius,
                s.frequency,
                s.phase,
                u8::from(s.cool)
            );
        }
        for x in [0.0, 140.0, 390.0, 960.0, 1210.0, 1920.0, 2200.0] {
            println!("{:.17} {:.17}", x, geometry::ground(x));
        }
    }
}

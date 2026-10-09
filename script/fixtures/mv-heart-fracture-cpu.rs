#[path = "../../rust/crates/editor-api/src/mv_recipe/heart_fracture.rs"]
mod fracture;
fn main() {
    let f = fracture::build([300.0, 262.3]);
    println!("{} {}", f.edges.len(), f.cells.len());
    for e in f.edges {
        println!(
            "E {} {:.17} {:.17} {}",
            e.kind,
            e.distance,
            e.length,
            e.points.len()
        );
        for p in e.points {
            println!("{:.17} {:.17}", p[0], p[1]);
        }
    }
    for c in f.cells {
        println!(
            "C {} {:.17} {:.17} {:.17} {}",
            c.ring,
            c.area,
            c.center[0],
            c.center[1],
            c.polygon.len()
        );
        for p in c.polygon {
            println!("{:.17} {:.17}", p[0], p[1]);
        }
    }
}

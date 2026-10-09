//! A rigid outgoing plane rotates around one straight, moving hinge.
use super::catalog::NumberRule;
use super::mesh_model::MeshVertex;
use super::transition_model::*;
use serde_json::{Value, json};

const HINGE: NumberRule = NumberRule {
    min: 0.0,
    max: 1.0,
    integer: false,
    suggested: 0.5,
};
const ANGLE: NumberRule = NumberRule {
    min: std::f64::consts::FRAC_PI_2,
    max: std::f64::consts::PI,
    integer: false,
    suggested: std::f64::consts::PI,
};
const PERSPECTIVE: NumberRule = NumberRule {
    min: 0.0,
    max: 0.8,
    integer: false,
    suggested: 0.5,
};
const SHADING: NumberRule = NumberRule {
    min: 0.0,
    max: 1.0,
    integer: false,
    suggested: 0.5,
};

pub fn valid(style: &Transition) -> bool {
    matches!(style, Transition::Bend { hinge, angle, perspective, shading, .. }
        if HINGE.valid(*hinge) && ANGLE.valid(*angle)
            && PERSPECTIVE.valid(*perspective) && SHADING.valid(*shading))
}

fn point(direction: Direction, u: f64, v: f64, width: f64, height: f64) -> [f64; 2] {
    match direction {
        Direction::Left => [u * width, v * height],
        Direction::Right => [(1.0 - u) * width, v * height],
        Direction::Up => [v * width, u * height],
        Direction::Down => [v * width, (1.0 - u) * height],
    }
}

pub fn plan(style: &Transition, p: f64, width: f64, height: f64) -> Vec<DrawCommand> {
    let Transition::Bend {
        direction,
        hinge,
        angle,
        perspective,
        shading,
    } = *style
    else {
        unreachable!()
    };
    if p <= 0.0 {
        return vec![DrawCommand::image(Input::From)];
    }
    if p >= 1.0 {
        return vec![DrawCommand::image(Input::To)];
    }
    let fold = if p <= 0.5 {
        1.0 - 2.0 * p * (1.0 - hinge)
    } else {
        2.0 * hinge * (1.0 - p)
    };
    let theta = p * angle;
    let image = |input, low, high| DrawCommand::Image {
        input,
        opacity: 1.0,
        transform: IDENTITY,
        replace: false,
        blend: Blend::SourceOver,
        clip: Some(Clip::Polygons {
            points: vec![vec![
                point(direction, low, 0.0, width, height),
                point(direction, high, 0.0, width, height),
                point(direction, high, 1.0, width, height),
                point(direction, low, 1.0, width, height),
            ]],
        }),
    };
    let mut commands = Vec::new();
    // The A/B base domains are disjoint, including when either source has holes.
    if fold < 1.0 {
        commands.push(image(Input::To, fold, 1.0));
    }
    if fold > 0.0 {
        commands.push(image(Input::From, 0.0, fold));
    }
    if fold >= 1.0 {
        return commands;
    }
    let vertices: Vec<MeshVertex> = [(fold, 0.0), (1.0, 0.0), (1.0, 1.0), (fold, 1.0)]
        .into_iter()
        .map(|(u, v)| {
            let distance = u - fold;
            let x = fold + distance * theta.cos();
            let z = distance * theta.sin();
            let clip_w = 1.0 - perspective * z;
            MeshVertex {
                position: point(
                    direction,
                    0.5 + (x - 0.5) / clip_w,
                    0.5 + (v - 0.5) / clip_w,
                    width,
                    height,
                ),
                uv: point(direction, u, v, 1.0, 1.0),
                w: clip_w,
            }
        })
        .collect();
    let twice_area: f64 = (0..4)
        .map(|i| {
            let a = vertices[i].position;
            let b = vertices[(i + 1) % 4].position;
            a[0] * b[1] - b[0] * a[1]
        })
        .sum();
    // Both orientations are drawable; only an edge-on plane has no coverage.
    if twice_area.abs() > width * height * 1e-12 {
        commands.push(DrawCommand::Mesh {
            input: Input::From,
            vertices,
            brightness: 1.0 - shading * (1.0 - theta.cos()) / 2.0,
            opacity: 1.0,
        });
    }
    commands
}

fn number(rule: NumberRule, unit: &str) -> Value {
    let mut value = serde_json::to_value(rule).expect("finite Bend rule");
    value["type"] = json!("number");
    value["unit"] = json!(unit);
    value
}

pub(super) fn catalog_entry() -> Value {
    json!({
        "requires":["worker-webgl2"],
        "binding":"scene.style plus scene.from, scene.to, scene.span and scene.easing",
        "clock":"explicit source-frame span -> eased progress; exact A/B endpoints; reversible ref",
        "parameters":{
            "direction":{"type":"enum", "options":[Direction::Left,Direction::Right,Direction::Up,Direction::Down], "suggested":"left"},
            "hinge":number(HINGE,"fold-axis position at progress 0.5"),
            "angle":number(ANGLE,"radians; maximum rotation at progress 1"),
            "perspective":number(PERSPECTIVE,"inverse camera distance in fold-axis lengths"),
            "shading":number(SHADING,"brightness reduction")
        },
        "constraints":["4 charged drawing operations: two A/B base draws plus two mesh triangles",
            "four extra surfaces charged to raster budget", "every listed parameter is required"],
        "geometry":"straight hinge moves 1 -> hinge -> 0; theta = progress * angle; one rigid plane, four vertices, perspective-correct source UVs",
        "alpha":"disjoint flat-A and exposed-B base domains; folded A preserves sampled coverage; brightness changes RGB only",
        "limitations":["recipe A/B scenes, not adjacent timeline clips", "no curved-page subdivision",
            "explicit error when Worker WebGL2 is unavailable"]
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_nonfinite_geometry_before_planning() {
        for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            for index in 0..4 {
                let mut fields = [0.5, std::f64::consts::PI, 0.5, 0.5];
                fields[index] = value;
                let style = Transition::Bend {
                    direction: Direction::Left,
                    hinge: fields[0],
                    angle: fields[1],
                    perspective: fields[2],
                    shading: fields[3],
                };
                assert!(!valid(&style));
            }
        }
    }

    #[test]
    fn direct_plan_endpoints_and_zero_area_hinges_are_bounded() {
        for hinge in [0.0, 0.5, 1.0] {
            let style = Transition::Bend {
                direction: Direction::Left,
                hinge,
                angle: std::f64::consts::PI,
                perspective: 0.8,
                shading: 1.0,
            };
            assert!(valid(&style));
            for (p, expected) in [(0.0, "from"), (1.0, "to")] {
                let result = serde_json::to_value(plan(&style, p, 192.0, 108.0)).unwrap();
                assert_eq!(result.as_array().unwrap().len(), 1);
                assert_eq!(result[0]["kind"], "image");
                assert_eq!(result[0]["input"], expected);
                assert_eq!(result[0]["opacity"], 1.0);
                assert!(result[0]["clip"].is_null());
            }
            for p in [0.0001, 0.25, 0.5, 0.75, 0.9999] {
                assert!(plan(&style, p, 192.0, 108.0).len() <= 3);
            }
        }
    }
}

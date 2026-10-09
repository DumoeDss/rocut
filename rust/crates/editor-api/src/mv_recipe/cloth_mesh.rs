use super::constraints::{length, sub};
use super::model::{Model, State};
use crate::mv_recipe::mesh_model::{MeshFace, MeshImagePlan, MeshVertex};

const NEAR_W: f64 = 0.05;

#[derive(Clone, Copy)]
struct Vertex {
    point: [f64; 3],
    uv: [f64; 2],
    w: f64,
}

pub(super) fn plan(model: &Model<'_>, state: &State, full_image: bool) -> MeshImagePlan {
    let settings = model.settings;
    let mut plan = MeshImagePlan {
        image: settings.image.clone(),
        rect: model.rect,
        fit: settings.fit,
        opacity: settings.opacity,
        full_image,
        faces: Vec::new(),
    };
    if full_image || settings.opacity == 0.0 {
        return plan;
    }
    let rect = model.rect;
    let center = [rect[0] + rect[2] / 2.0, rect[1] + rect[3] / 2.0];
    let camera = 8.0 * model.size[0].max(model.size[1]);
    let vertex = |index: usize| {
        let uv = settings.uv(index);
        let point = state.points[index].position;
        Vertex {
            point,
            uv: [
                (rect[0] + uv[0] * rect[2]) / f64::from(model.identity.dimensions[0]),
                (rect[1] + uv[1] * rect[3]) / f64::from(model.identity.dimensions[1]),
            ],
            w: 1.0 - settings.perspective * point[2] / camera,
        }
    };
    let stride = settings.columns as usize + 1;
    plan.faces
        .reserve((settings.columns * settings.rows * 2) as usize);
    for y in 0..settings.rows as usize {
        for x in 0..settings.columns as usize {
            let a = y * stride + x;
            for ids in [[a, a + 1, a + stride], [a + 1, a + stride + 1, a + stride]] {
                let triangle = ids.map(vertex);
                let u = sub(triangle[1].point, triangle[0].point);
                let v = sub(triangle[2].point, triangle[0].point);
                let normal = [
                    u[1] * v[2] - u[2] * v[1],
                    u[2] * v[0] - u[0] * v[2],
                    u[0] * v[1] - u[1] * v[0],
                ];
                let magnitude = length(normal);
                let facing = if magnitude > f64::MIN_POSITIVE {
                    (normal[2].abs() / magnitude).min(1.0)
                } else {
                    1.0
                };
                let clipped = clip(triangle);
                if clipped.len() < 3 {
                    continue;
                }
                let depth = clipped
                    .iter()
                    .map(|v| v.point[2] / clipped.len() as f64)
                    .sum();
                let vertices = clipped
                    .into_iter()
                    .map(|v| MeshVertex {
                        position: [
                            center[0] + v.point[0] * model.short / v.w,
                            center[1] + v.point[1] * model.short / v.w,
                        ],
                        uv: v.uv,
                        w: v.w,
                    })
                    .collect();
                plan.faces.push(MeshFace {
                    vertices,
                    brightness: 1.0 - settings.shading * (1.0 - facing),
                    opacity: settings.opacity,
                    depth,
                    color_offset: None,
                });
            }
        }
    }
    // Stable for equal-depth triangles, far-to-near for positive z toward camera.
    plan.faces.sort_by(|a, b| a.depth.total_cmp(&b.depth));
    plan
}

fn clip(triangle: [Vertex; 3]) -> Vec<Vertex> {
    let mut output = Vec::with_capacity(4);
    let mut previous = triangle[2];
    for current in triangle {
        let previous_inside = previous.w >= NEAR_W;
        let current_inside = current.w >= NEAR_W;
        // A vertex already on the clipping plane is the intersection itself;
        // avoid appending a duplicate endpoint and a degenerate triangle fan.
        if previous_inside != current_inside && previous.w != NEAR_W && current.w != NEAR_W {
            let t = (NEAR_W - previous.w) / (current.w - previous.w);
            let mut crossing = Vertex {
                point: [0.0; 3],
                uv: [0.0; 2],
                w: NEAR_W,
            };
            for axis in 0..3 {
                crossing.point[axis] =
                    previous.point[axis] + t * (current.point[axis] - previous.point[axis]);
            }
            for axis in 0..2 {
                crossing.uv[axis] = previous.uv[axis] + t * (current.uv[axis] - previous.uv[axis]);
            }
            output.push(crossing);
        }
        if current_inside {
            output.push(current);
        }
        previous = current;
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clipping_at_an_exact_near_plane_vertex_does_not_duplicate_endpoints() {
        for (divisors, expected) in [
            ([NEAR_W, -0.1, 1.0], 3),
            ([NEAR_W, -0.1, -0.2], 1),
            ([NEAR_W, NEAR_W, 1.0], 3),
            ([1.0, -0.1, 1.0], 4),
        ] {
            let triangle = [0, 1, 2].map(|i| Vertex {
                point: [i as f64, (i * i) as f64, 0.0],
                uv: [i as f64 / 2.0, (2 - i) as f64 / 2.0],
                w: divisors[i],
            });
            let polygon = clip(triangle);
            assert_eq!(polygon.len(), expected);
            for i in 0..polygon.len() {
                for j in i + 1..polygon.len() {
                    assert_ne!(polygon[i].uv, polygon[j].uv);
                }
                assert!(polygon[i].w >= NEAR_W);
            }
        }
    }
}

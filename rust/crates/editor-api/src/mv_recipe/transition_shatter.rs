use super::transition_model::*;
use super::transitions::{random, transformed};

pub fn plan(style: &Transition, p: f64, w: f64, h: f64, source_seed: u32) -> Vec<DrawCommand> {
    let Transition::Shatter {
        seed,
        center,
        columns,
        rows,
        edge,
    } = style
    else {
        unreachable!()
    };
    let seed = seed ^ source_seed;
    let cx = center[0] * w;
    let cy = center[1] * h;
    let vertex = |i: u32, j: u32| {
        let key = j * (columns + 1) + i;
        let dx = if i > 0 && i < *columns {
            (random(seed, key * 2 + 1) * 2.0 - 1.0) * 0.35
        } else {
            0.0
        };
        let dy = if j > 0 && j < *rows {
            (random(seed, key * 2 + 2) * 2.0 - 1.0) * 0.35
        } else {
            0.0
        };
        [
            (f64::from(i) + dx) / f64::from(*columns) * w,
            (f64::from(j) + dy) / f64::from(*rows) * h,
        ]
    };
    let mut ops = vec![DrawCommand::image(Input::To)];
    for j in 0..*rows {
        for i in 0..*columns {
            let points = [
                vertex(i, j),
                vertex(i + 1, j),
                vertex(i + 1, j + 1),
                vertex(i, j + 1),
            ];
            for (half, tri) in [
                [points[0], points[1], points[2]],
                [points[0], points[2], points[3]],
            ]
            .iter()
            .enumerate()
            {
                let mx = tri.iter().map(|v| v[0]).sum::<f64>() / 3.0;
                let my = tri.iter().map(|v| v[1]).sum::<f64>() / 3.0;
                let dist = (mx - cx).hypot(my - cy) / w.hypot(h);
                let d = ((p - dist * 0.6) / 0.5).clamp(0.0, 1.0);
                let e = d * d;
                if d >= 1.0 {
                    continue;
                }
                // Random motion is keyed to a stable shard, not a stream consumed
                // only by currently visible shards. Reverse seek cannot change it.
                let key = 10_000 + ((j * columns + i) * 2 + half as u32) * 3;
                let vx = (mx - cx) * 0.9 + (random(seed, key) * 2.0 - 1.0) * w * 0.104;
                let vy = (my - cy) * 0.5 + (random(seed, key + 1) * 2.0 - 1.0) * h * 0.093;
                let transform = transformed(
                    mx,
                    my,
                    mx + vx * e,
                    my + vy * e + h * 1.296 * e * e,
                    (random(seed, key + 2) * 2.0 - 1.0) * 3.0 * e,
                    1.0 - e * 0.3,
                );
                ops.push(DrawCommand::Image {
                    input: Input::From,
                    opacity: 1.0 - e * 0.5,
                    transform,
                    clip: Some(Clip::Polygons {
                        points: vec![tri.to_vec()],
                    }),
                    replace: false,
                    blend: Blend::SourceOver,
                });
                if let Some(edge) = edge {
                    ops.push(DrawCommand::Stroke {
                        color: edge.color,
                        opacity: 1.0 - e,
                        width: edge.width * w.min(h),
                        path: Clip::Polygons {
                            points: vec![tri.to_vec()],
                        },
                        role: edge.role,
                        transform,
                    });
                }
            }
        }
    }
    ops
}

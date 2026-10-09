//! Analytical cylindrical A/B page fold.
//! The incoming picture is exposed behind a deforming, shaded outgoing surface.
use super::transition_model::*;

type Point = [f64; 2];
fn point(direction: Direction, u: f64, v: f64, w: f64, h: f64) -> Point {
    match direction {
        Direction::Left => [u * w, v * h],
        Direction::Right => [(1.0 - u) * w, v * h],
        Direction::Up => [v * w, u * h],
        Direction::Down => [v * w, (1.0 - u) * h],
    }
}
fn polygon(points: Vec<Point>) -> Clip {
    Clip::Polygons {
        points: vec![points],
    }
}
fn affine(source: [Point; 3], target: [Point; 3]) -> [f64; 6] {
    let [a, b, c] = source;
    let [d, e, f] = target;
    let (bx, by, cx, cy) = (b[0] - a[0], b[1] - a[1], c[0] - a[0], c[1] - a[1]);
    let (ex, ey, fx, fy) = (e[0] - d[0], e[1] - d[1], f[0] - d[0], f[1] - d[1]);
    let det = bx * cy - cx * by;
    let (xx, yx, xy, yy) = (
        (ex * cy - fx * by) / det,
        (ey * cy - fy * by) / det,
        (fx * bx - ex * cx) / det,
        (fy * bx - ey * cx) / det,
    );
    [
        xx,
        yx,
        xy,
        yy,
        d[0] - xx * a[0] - xy * a[1],
        d[1] - yx * a[0] - yy * a[1],
    ]
}

pub fn plan(style: &Transition, p: f64, w: f64, h: f64) -> Vec<DrawCommand> {
    let Transition::Peel {
        direction,
        curl,
        segments,
        shading,
        perspective,
    } = *style
    else {
        unreachable!()
    };
    let arc = std::f64::consts::PI * curl;
    // At p=0 all of A is flat; at p=1 the last curved point has left the frame.
    let fold = 1.0 - p * (1.0 + arc / 2.0);
    let split = fold.clamp(0.0, 1.0);
    let rect = |start: f64, end: f64| {
        polygon(vec![
            point(direction, start, 0.0, w, h),
            point(direction, end, 0.0, w, h),
            point(direction, end, 1.0, w, h),
            point(direction, start, 1.0, w, h),
        ])
    };
    let image = |input, clip| DrawCommand::Image {
        input,
        opacity: 1.0,
        transform: IDENTITY,
        clip: Some(clip),
        replace: false,
        blend: Blend::SourceOver,
    };
    // Do not reveal B through transparent, still-flat A pixels at the first tick.
    let mut commands = vec![image(Input::To, rect(split, 1.0))];
    if split > 0.0 {
        commands.push(image(Input::From, rect(0.0, split)));
    }
    let surface = |u: f64, v: f64| {
        let distance = (u - fold).max(0.0);
        let angle = (distance / curl).min(std::f64::consts::PI);
        let x = fold + curl * angle.sin() - (distance - arc).max(0.0);
        let z = curl * (1.0 - angle.cos());
        let scale = 1.0 / (1.0 - perspective * z);
        (
            point(
                direction,
                0.5 + (x - 0.5) * scale,
                0.5 + (v - 0.5) * scale,
                w,
                h,
            ),
            z,
            angle,
        )
    };
    let mut strips = Vec::new();
    for i in 0..segments {
        let u0 = split + (1.0 - split) * f64::from(i) / f64::from(segments);
        let u1 = split + (1.0 - split) * f64::from(i + 1) / f64::from(segments);
        if u1 - u0 <= f64::EPSILON {
            continue;
        }
        let (_, depth, angle) = surface((u0 + u1) / 2.0, 0.5);
        let brightness = 1.0 - shading * (1.0 - angle.cos()) / 2.0;
        let source = [
            point(direction, u0, 0.0, w, h),
            point(direction, u1, 0.0, w, h),
            point(direction, u1, 1.0, w, h),
            point(direction, u0, 1.0, w, h),
        ];
        let target = [
            surface(u0, 0.0).0,
            surface(u1, 0.0).0,
            surface(u1, 1.0).0,
            surface(u0, 1.0).0,
        ];
        strips.push((depth, brightness, source, target));
    }
    // Painter order is deterministic; the raised backside occludes flatter parts.
    strips.sort_by(|a, b| a.0.total_cmp(&b.0));
    for (_, brightness, source, target) in strips {
        for indices in [[0, 1, 2], [0, 2, 3]] {
            let input = indices.map(|i| source[i]);
            let transform = affine(input, indices.map(|i| target[i]));
            if (transform[0] * transform[3] - transform[1] * transform[2]).abs() < 1e-8 {
                continue;
            }
            commands.push(DrawCommand::Surface {
                input: Input::From,
                opacity: 1.0,
                transform,
                clip: polygon(input.to_vec()),
                brightness,
            });
        }
    }
    commands
}

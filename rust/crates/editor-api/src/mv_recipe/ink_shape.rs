use super::{math::*, network::Tendril, paths::Point, plan::Step};
fn ribbon(out: &mut Vec<Step>, p: &[Point], wd: &[f64]) {
    if p.len() < 2 {
        return;
    }
    let normals: Vec<_> = p
        .iter()
        .enumerate()
        .map(|(i, _)| {
            let a = p[i.saturating_sub(1)];
            let b = p[(i + 1).min(p.len() - 1)];
            let tx = b[0] - a[0];
            let ty = b[1] - a[1];
            let len = tx.hypot(ty);
            let len = if len == 0. { 1. } else { len };
            [-ty / len, tx / len]
        })
        .collect();
    out.push(Step::MoveTo {
        point: [
            p[0][0] + normals[0][0] * wd[0] / 2.,
            p[0][1] + normals[0][1] * wd[0] / 2.,
        ],
    });
    for i in 1..p.len() {
        out.push(Step::LineTo {
            point: [
                p[i][0] + normals[i][0] * wd[i] / 2.,
                p[i][1] + normals[i][1] * wd[i] / 2.,
            ],
        });
    }
    for i in (0..p.len()).rev() {
        out.push(Step::LineTo {
            point: [
                p[i][0] - normals[i][0] * wd[i] / 2.,
                p[i][1] - normals[i][1] * wd[i] / 2.,
            ],
        });
    }
    out.push(Step::Close);
}
pub(super) fn append(out: &mut Vec<Step>, tn: &Tendril, time: f64, front: bool) {
    if front && tn.front.is_none() {
        return;
    }
    let k = clamp((time - tn.delay) / tn.duration);
    let f = 1.0 - (1.0 - k).powf(2.0);
    if f <= 0. {
        return;
    }
    let n = tn.points.len();
    let m = (f * (n - 1) as f64).floor() as usize + 1;
    if m < 3 {
        return;
    }
    let tip = (m - 1).min(22) as f64;
    let widths: Vec<_> = (0..m)
        .map(|j| {
            let u = j as f64 / (n - 1) as f64;
            let profile = tn.end_width.map_or_else(
                || tn.width * (1.0 - u).powf(1.15) + 1.3,
                |end| lerp(tn.width, end, u),
            );
            profile
                * clamp((m - 1 - j) as f64 / tip).powf(0.6)
                * (1.0 + 0.22 * noise(j as f64 * 0.11, tn.seed))
        })
        .collect();
    let Some(selection) = &tn.front else {
        ribbon(out, &tn.points[..m], &widths);
        return;
    };
    let mut run = vec![];
    let flush = |run: &mut Vec<usize>, out: &mut Vec<Step>| {
        if run.len() > 2 {
            let p: Vec<_> = run.iter().map(|j| tn.points[*j]).collect();
            let w: Vec<_> = run.iter().map(|j| widths[*j]).collect();
            ribbon(out, &p, &w);
        }
        run.clear();
    };
    for (j, selected) in selection.iter().enumerate().take(m) {
        if *selected == front {
            run.push(j);
        } else {
            flush(&mut run, out);
        }
    }
    flush(&mut run, out);
}

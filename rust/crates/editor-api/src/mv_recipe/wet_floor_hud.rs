use super::{
    canvas::Canvas,
    count::{camera, Drop, CX, CY},
    math::*,
    model::{Sample, Settings},
};
pub fn draw(a: &Settings, s: &Sample<'_>, plan: &[Drop], c: &mut Canvas) {
    let t = s.time();
    let done: Vec<_> = plan.iter().filter(|d| d.t <= t + 1e-6).collect();
    let n = done.len();
    let last = done.last();
    let tone = &a.hud_color;
    let alpha = a.hud_alpha;
    c.save();
    c.baseline("middle");
    if let Some(last) = last {
        let age = t - last.t;
        if age < 0.9 {
            let (rot, zoom) = camera(s.progress());
            let lx = last.u * zoom;
            let ly = last.v * zoom;
            let x = CX + lx * rot.cos() - ly * rot.sin();
            let y = CY + lx * rot.sin() + ly * rot.cos();
            let e = out_expo(sat(age / 0.16));
            let size = lerp(1.7, 1.0, e);
            let al = alpha * sat(age / 0.03) * sat((0.9 - age) / 0.3);
            let bw = 86.0 * size;
            let bh = 56.0 * size;
            c.stroke_color(&rgba(tone, al));
            c.width(2.0);
            c.begin();
            for (sx, sy) in [(-1.0, -1.0), (1.0, -1.0), (1.0, 1.0), (-1.0, 1.0)] {
                let xx = x + sx * bw;
                let yy = y + sy * bh;
                c.move_to(xx - sx * 16.0, yy);
                c.line_to(xx, yy);
                c.line_to(xx, yy - sy * 16.0);
            }
            c.stroke();
            c.font("dot400", 20.0);
            c.fill_color(&rgba(tone, al));
            c.align("left");
            c.text(&format!("{:02}", last.n), x + bw + 10.0, y - bh + 6.0);
        }
    }
    let xr = W - 112.0;
    let yb = H - 96.0;
    c.align("left");
    c.font("dot400", 21.0);
    c.fill_color(&rgba(tone, alpha * 0.8));
    c.text("COUNT", xr - 262.0, yb - 178.0);
    c.fill_rect([xr - 180.0, yb - 178.0, 180.0, 1.0]);
    let age = last.map_or(1e3, |d| t - d.t);
    let e = out_expo(sat(age / 0.14));
    c.save();
    c.begin();
    c.rect([xr - 300.0, yb - 158.0, 300.0, 124.0]);
    c.clip("nonzero");
    c.font("dot400", 124.0);
    c.align("right");
    let cur = format!("{n:02}");
    let prev = format!("{:02}", n.saturating_sub(1));
    c.shadow("rgba(255,160,70,0.8)", 22.0);
    if e < 1.0 && n > 0 {
        c.fill_color(&rgba(tone, alpha * (1.0 - e)));
        c.text(&prev, xr, yb - 96.0 - e * 110.0);
        c.fill_color(&rgba(tone, alpha));
        c.text(&cur, xr, yb - 96.0 + (1.0 - e) * 110.0);
    } else {
        c.fill_color(&rgba(tone, alpha));
        c.text(&cur, xr, yb - 96.0);
    }
    c.restore();
    let total = 8usize.max(plan.len());
    for i in 0..total {
        let x = xr - (total - i) as f64 * 20.0 + 8.0;
        let on = i < n;
        c.fill_color(&rgba(
            if on { "#FFB060" } else { tone },
            if on { alpha } else { alpha * 0.25 },
        ));
        c.fill_rect(if on {
            [x, yb - 10.0, 12.0, 12.0]
        } else {
            [x, yb - 5.0, 12.0, 2.0]
        });
    }
    let secs = 7.0 + (t - s.start()).floor();
    let blink = phase(s.beats, a.bpm, t) < 0.5;
    let sep = if blink { ":" } else { " " };
    let seconds = format!("{secs:.0}");
    let seconds = if seconds.len() < 2 {
        format!("0{seconds}")
    } else {
        seconds
    };
    c.font("dot400", 22.0);
    c.align("left");
    c.fill_color(&rgba(tone, alpha * 0.7));
    c.text(&format!("23{sep}41{sep}{seconds}"), 112.0, 96.0);
    c.font("dot400", 18.0);
    c.fill_color(&rgba(tone, alpha * 0.45));
    c.text("RAIN  7.5mm/h   水面観測", 112.0, 128.0);
    c.restore();
}

use super::*;
pub fn measuring_ring(d: &mut Draw, impact: [f64; 2], tq: f64, c: &Timing, burn: bool) {
    let k = if c.broken {
        out_cubic(inv(0.0, 0.8, c.tau))
    } else {
        0.0
    };
    let radius = 372.0 + 900.0 * k;
    let a = if c.broken { 0.3 * (1.0 - k) } else { 0.22 } * if burn { 0.8 } else { 1.0 };
    if a <= 0.005 {
        return;
    }
    let saved = d.operations.clone();
    d.operations.push(Operation::Translate { offset: impact });
    d.operations.push(Operation::Rotate { radians: tq * 0.12 });
    let col = alpha(
        if burn {
            rgb(255.0, 138.0, 90.0, 1.0)
        } else {
            rgb(233.0, 184.0, 230.0, 1.0)
        },
        a,
    );
    d.path(
        vec![arc([0.0, 0.0], radius, 0.08, std::f64::consts::TAU - 0.08)],
        vec![stroke(col, 1.4, "lighter", "butt", "miter")],
    );
    for offset in [0.0, 1.0] {
        d.path(
            vec![arc(
                [0.0, 0.0],
                radius + 14.0,
                std::f64::consts::PI * (offset + 0.1),
                std::f64::consts::PI * (offset + 0.62),
            )],
            vec![stroke(col, 1.4, "lighter", "butt", "miter")],
        );
    }
    let mut path = Vec::with_capacity(144);
    for i in 0..72 {
        let a = i as f64 / 72.0 * std::f64::consts::TAU;
        let len = if i % 6 == 0 { 14.0 } else { 6.0 };
        path.push(mv([a.cos() * (radius - 4.0), a.sin() * (radius - 4.0)]));
        path.push(ln([
            a.cos() * (radius - 4.0 - len),
            a.sin() * (radius - 4.0 - len),
        ]));
    }
    d.path(path, vec![stroke(col, 1.4, "lighter", "butt", "miter")]);
    d.operations = saved;
}

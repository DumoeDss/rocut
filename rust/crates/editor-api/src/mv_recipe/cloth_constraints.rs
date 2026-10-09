use super::model::Particle;
use super::{Cloth, DT};

#[derive(Clone, Copy)]
pub(super) struct Constraint {
    pub a: usize,
    pub b: usize,
    pub rest: f64,
    alpha: f64,
}

pub(super) fn count(columns: u32, rows: u32) -> u64 {
    let (c, r) = (u64::from(columns), u64::from(rows));
    // Horizontal/vertical structural, both diagonals, and two-edge bending.
    c * (r + 1) + r * (c + 1) + 2 * c * r + (c - 1) * (r + 1) + (r - 1) * (c + 1)
}

pub(super) fn build(settings: &Cloth, size: [f64; 2]) -> Vec<Constraint> {
    let stride = settings.columns as usize + 1;
    let mut constraints = Vec::with_capacity(count(settings.columns, settings.rows) as usize);
    let mut add = |a, b, compliance| {
        let pa = rest(settings, size, a);
        let pb = rest(settings, size, b);
        constraints.push(Constraint {
            a,
            b,
            rest: length(sub(pa, pb)),
            alpha: compliance / (DT * DT),
        });
    };
    for y in 0..=settings.rows as usize {
        for x in 0..=settings.columns as usize {
            let a = y * stride + x;
            if x < settings.columns as usize {
                add(a, a + 1, settings.stretch_compliance);
            }
            if y < settings.rows as usize {
                add(a, a + stride, settings.stretch_compliance);
            }
            if x < settings.columns as usize && y < settings.rows as usize {
                add(a, a + stride + 1, settings.stretch_compliance);
                add(a + 1, a + stride, settings.stretch_compliance);
            }
            // Distance bending approximates flexion, not a dihedral-angle model.
            if x + 2 <= settings.columns as usize {
                add(a, a + 2, settings.bend_compliance);
            }
            if y + 2 <= settings.rows as usize {
                add(a, a + 2 * stride, settings.bend_compliance);
            }
        }
    }
    constraints
}

pub(super) fn rest(settings: &Cloth, size: [f64; 2], index: usize) -> [f64; 3] {
    let uv = settings.uv(index);
    [(uv[0] - 0.5) * size[0], (uv[1] - 0.5) * size[1], 0.0]
}

pub(super) fn solve(settings: &Cloth, points: &mut [Particle], c: Constraint, lambda: &mut f64) {
    let wa = if settings.pinned(c.a) { 0.0 } else { 1.0 };
    let wb = if settings.pinned(c.b) { 0.0 } else { 1.0 };
    if wa + wb == 0.0 {
        return;
    }
    let delta = sub(points[c.a].position, points[c.b].position);
    let distance = length(delta);
    // A collapsed pair has no unique gradient; the next nondegenerate constraint
    // can separate it without inventing a velocity or displacing a pin.
    if distance <= f64::MIN_POSITIVE {
        return;
    }
    let dl = (-(distance - c.rest) - c.alpha * *lambda) / (wa + wb + c.alpha);
    *lambda += dl;
    for (axis, d) in delta.into_iter().enumerate() {
        let correction = d / distance * dl;
        if wa != 0.0 {
            points[c.a].position[axis] += wa * correction;
        }
        if wb != 0.0 {
            points[c.b].position[axis] -= wb * correction;
        }
    }
}

pub(super) fn sub(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

pub(super) fn length(a: [f64; 3]) -> f64 {
    (a[0] * a[0] + a[1] * a[1] + a[2] * a[2]).sqrt()
}

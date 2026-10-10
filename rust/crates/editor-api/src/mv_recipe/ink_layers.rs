use super::{clock::Clock, draw::*, math::*, network::Network, plan::*, raster::*, shape};
pub(super) fn pools(out: &mut Vec<Command>, c: &Clock, n: &Network) {
    let mut a = Draw::new(1920., 1080.);
    a.rect(
        [0., 0., 510., 300.],
        fill(solid(rgb(255, 255, 255, 1.)), "source-over"),
    );
    a.operations = c.camera();
    a.operations.push(Operation::CopyScaledTransform {
        scale: 0.25,
        offset: [60., 60.],
    });
    for [x, y, rmax, flatten, delay, duration] in &n.pools {
        let k = 1.0 - (1.0 - clamp((c.ink_time - delay) / duration)).powf(2.0);
        let r = rmax * (0.15 + 0.85 * k) * (1.0 + 0.04 * (c.quantized * 2.0 + x).sin());
        if k <= 0. {
            continue;
        }
        a.path(
            vec![Step::Ellipse {
                center: [*x, *y],
                radii: [r, r * flatten + 8.],
                rotation: 0.,
                start: 0.,
                end: TAU,
                anticlockwise: false,
            }],
            vec![fill(solid(rgb(0, 0, 0, 1.)), "source-over")],
        );
    }
    surface(out, "ik-pool-a", [510, 300], a);
    let mut b = Draw::new(1920., 1080.);
    b.rect(
        [0., 0., 510., 300.],
        fill(solid(rgb(255, 255, 255, 1.)), "source-over"),
    );
    blit(
        &mut b,
        "ik-pool-a",
        [0., 0., 510., 300.],
        [0., 0., 510., 300.],
        "source-over",
        1.,
        4.,
        Some(14.),
    );
    surface(out, "ik-pool-b", [510, 300], b);
    release(out, "ik-pool-a");
    let mut scene = Draw::new(1920., 1080.);
    blit(
        &mut scene,
        "ik-pool-b",
        [15., 15., 480., 270.],
        FRAME,
        "multiply",
        0.92,
        0.,
        None,
    );
    append(out, "ik-scene", scene);
    release(out, "ik-pool-b");
}
pub(super) fn tendrils(out: &mut Vec<Command>, c: &Clock, n: &Network, front: bool) {
    let (mask, ha, hb, qa, qb) = if front {
        (
            "ik-front",
            "ik-front-ha",
            "ik-front-hb",
            "ik-front-qa",
            "ik-front-qb",
        )
    } else {
        (
            "ik-back",
            "ik-back-ha",
            "ik-back-hb",
            "ik-back-qa",
            "ik-back-qb",
        )
    };
    let mut d = Draw::new(1920., 1080.);
    d.operations = c.camera();
    d.operations.push(Operation::CopyTransform);
    let mut path = vec![];
    for tn in &n.tendrils {
        shape::append(&mut path, tn, c.ink_time, front);
    }
    // One beginPath and one fill across every selected tendril, including an
    // empty path. Separate fills would change alpha at overlapping edges.
    d.path(path, vec![fill(solid(rgb(0, 0, 0, 1.)), "source-over")]);
    d.operations.clear();
    all(
        &mut d,
        "ik-mot",
        [480, 270],
        FRAME,
        "destination-out",
        0.28,
        0.,
    );
    all(
        &mut d,
        "ik-mot2",
        [480, 270],
        FRAME,
        "destination-out",
        0.18,
        0.,
    );
    surface(out, mask, [1920, 1080], d);
    for (scale, a, b, blur, alpha) in [(0.5, ha, hb, 7., 0.42), (0.25, qa, qb, 10., 0.25)] {
        let size = [(1920.0 * scale) as u32, (1080.0 * scale) as u32];
        let mut a_draw = Draw::new(1920. * scale, 1080. * scale);
        all(
            &mut a_draw,
            mask,
            [1920, 1080],
            FRAME,
            "source-over",
            1.,
            0.,
        );
        surface(out, a, size, a_draw);
        let mut b_draw = Draw::new(1920., 1080.);
        all(
            &mut b_draw,
            a,
            size,
            [0., 0., size[0] as f64, size[1] as f64],
            "source-over",
            1.,
            blur,
        );
        surface(out, b, size, b_draw);
        release(out, a);
        let mut scene = Draw::new(1920., 1080.);
        all(&mut scene, b, size, FRAME, "source-over", alpha, 0.);
        append(out, "ik-scene", scene);
        release(out, b);
    }
    let mut scene = Draw::new(1920., 1080.);
    all(
        &mut scene,
        mask,
        [1920, 1080],
        FRAME,
        "source-over",
        0.95,
        0.,
    );
    append(out, "ik-scene", scene);
    release(out, mask);
}

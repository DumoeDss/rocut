use super::{clock::Clock, draw::*, math::*, plan::*, raster::*, texture};
pub(super) fn linear(from: [f64; 2], to: [f64; 2], items: &[(f64, [f64; 4])]) -> Style {
    Style::Linear {
        from,
        to,
        stops: stops(items),
    }
}
pub(super) fn draw(d: &mut Draw, c: &Clock) {
    d.operations = c.camera();
    d.rect(
        COVER,
        fill(
            linear(
                [0., -100.],
                [0., 1180.],
                &[
                    (0., rgb(201, 196, 195, 1.)),
                    (0.5, rgb(185, 179, 179, 1.)),
                    (0.82, rgb(167, 160, 162, 1.)),
                    (1., rgb(140, 133, 137, 1.)),
                ],
            ),
            "source-over",
        ),
    );
    d.rect(
        COVER,
        fill(
            radial(
                960.,
                500.,
                720.,
                &[
                    (0., rgb(238, 232, 226, 0.9)),
                    (0.45, rgb(232, 226, 220, 0.45)),
                    (1., rgb(232, 226, 220, 0.)),
                ],
            ),
            "source-over",
        ),
    );
    d.rect(
        COVER,
        fill(
            radial(
                1500.,
                160.,
                820.,
                &[
                    (0., rgb(255, 208, 160, 0.42)),
                    (0.4, rgb(255, 208, 160, 0.12)),
                    (1., rgb(255, 208, 160, 0.)),
                ],
            ),
            "source-over",
        ),
    );
    texture::scroll(d, "ik-fog", -c.time * 26., 0., 2880., 1620., 0.5);
    texture::scroll(d, "ik-fog", c.time * 14. + 900., 380., 1920., 1080., 0.3);
    d.operations.extend([
        Operation::Translate {
            offset: [960., 992.],
        },
        Operation::Scale {
            factors: [1., 0.15],
        },
        Operation::Translate {
            offset: [-960., -992.],
        },
    ]);
    d.commands.push(Command::GradientRect {
        transform: d.identity(),
        operations: d.operations.clone(),
        clip: None,
        style_transform: d.identity(),
        style_operations: c.camera(),
        rect: [600., 640., 720., 720.],
        paint: fill(
            radial(
                960.,
                992.,
                330.,
                &[(0., rgb(40, 34, 40, 0.4)), (1., rgb(40, 34, 40, 0.))],
            ),
            "source-over",
        ),
    });
}
pub(super) fn vignette(d: &mut Draw) {
    d.operations.clear();
    d.rect(
        FRAME,
        fill(
            Style::Radial {
                from: [960., 540., 1080. * 0.38],
                to: [960., 540., 1080. * 1.05],
                stops: stops(&[(0., rgb(30, 26, 32, 0.)), (1., rgb(30, 26, 32, 0.55))]),
            },
            "source-over",
        ),
    );
}

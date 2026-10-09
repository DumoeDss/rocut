use super::{
    clock::Clock,
    draw::*,
    ease::{ease, hit},
    images,
    labels::{Label, panels},
    math::*,
    model::{Easing, TitleRiff, View},
    palette::Palette,
    plan::*,
    raster::*,
    recording::{DESIGN_SIZE, Recording},
    state::State,
};
use crate::{mv_font_metrics, mv_image_dimensions};

pub(super) fn needs_mask(a: &TitleRiff, c: &Clock, s: &State) -> bool {
    !a.outro()
        && s.radius * (1.0 + s.exit * 6.5) >= 1.0
        && a.cues.sil >= 0
        && c.time >= c.at(a.cues.sil)
        && 1.0 - clamp(s.exit * 2.2) > 0.0
}
pub(super) fn draw(
    d: &mut Draw,
    a: &TitleRiff,
    c: &Clock,
    s: &State,
    p: &Palette,
    images: &mv_image_dimensions::Context,
    mask: Option<[u32; 2]>,
    recording: &mut Recording,
) -> Result<(), String> {
    let t = c.time;
    let x = s.x;
    let y = s.y;
    let radius = s.radius * (1.0 + s.exit * 6.5);
    if radius < 1.0 {
        return Ok(());
    }
    recording.save(&[]);
    d.operations = recording.operations();
    d.clip = Some(Clip {
        transform: IDENTITY,
        operations: d.operations.clone(),
        path: circle(x, y, radius),
    });
    if !a.outro() {
        d.rect(
            [x - radius, y - radius, 2.0 * radius, 2.0 * radius],
            fill(
                radial_between(
                    [x - radius * 0.15, y - radius * 0.3, radius * 0.05],
                    [x, y, radius],
                    &[(0.0, p.core), (0.45, p.hi), (0.82, p.glow), (1.0, p.sunset)],
                ),
                "source-over",
            ),
        );
        if let Some(size) = mask {
            let k = ease(seg(t, c.at(a.cues.sil), 0.8), Easing::Out);
            let fade = 1.0 - clamp(s.exit * 2.2);
            let h = s.radius * 1.86;
            let bottom = y + s.radius * 1.02 + (1.0 - k) * s.radius * 1.1;
            let qt = (t * 12.0 + 1e-6).floor() / 12.0;
            let sway = 0.006 * (qt * 1.4).sin();
            let alpha = fade * clamp(k * 1.5);
            for [dx, dy] in [
                [-3.0, -2.0],
                [3.0, -2.0],
                [0.0, -4.0],
                [-2.0, 2.0],
                [2.0, 2.0],
            ] {
                images::mask_sprite(
                    d,
                    "title-rim",
                    size,
                    [x + dx, bottom + dy],
                    h,
                    sway,
                    alpha,
                    recording,
                )?;
            }
            images::mask_sprite(
                d,
                "title-sky-cutout",
                size,
                [x, bottom],
                h,
                sway,
                alpha,
                recording,
            )?;
        }
        blit(
            d,
            "title-half-9",
            [1920, 1080],
            FRAME,
            "multiply",
            0.1,
            0.0,
            "low",
        );
        recording.surface("disc-halftone", 0, DESIGN_SIZE)?;
    } else {
        let bi = c.recap_index();
        let final_beat = a.cues.exit as usize;
        let final_frame = bi >= final_beat;
        let recap = a.recap.as_ref().expect("validated recap");
        let item = &recap[bi % recap.len()];
        let bg = if final_frame {
            a.final_image.as_deref().expect("validated final")
        } else {
            &item.bg
        };
        let view = if final_frame {
            View {
                zoom: 1.0,
                x: 0.0,
                y: 0.0,
                rot: 0.0,
            }
        } else {
            item.view
        };
        let zoom = if final_frame {
            1.0
        } else {
            1.0 + 0.07 * (1.0 - ease(clamp((t - c.cues[bi]) / 0.46), Easing::Out))
        };
        recording.save(&[
            Operation::Translate { offset: [x, y] },
            Operation::Scale {
                factors: [zoom, zoom],
            },
            Operation::Translate { offset: [-x, -y] },
        ]);
        d.operations = recording.operations();
        if final_frame {
            images::cover(d, bg, view, images, recording)?;
        } else {
            recording.transform(Operation::Translate {
                offset: [x - 960.0, y - 540.0],
            });
            d.operations = recording.operations();
            images::cover(
                d,
                bg,
                View {
                    zoom: view.zoom * 0.75,
                    ..view
                },
                images,
                recording,
            )?;
        }
        recording.restore();
        d.operations = recording.operations();
        if !final_frame {
            if let Some(character) = &item.character {
                let qt = (t * 12.0 + 1e-6).floor() / 12.0;
                images::sprite(
                    d,
                    character,
                    [
                        x + item.cx * s.radius,
                        y + s.radius * if item.cy == 0.0 { 1.05 } else { item.cy },
                    ],
                    s.radius * item.h,
                    [0.5, 1.0],
                    0.0,
                    1.0 + 0.012 * (qt * 2.1).sin(),
                    1.0,
                    images,
                    recording,
                )?;
            }
        }
        if !final_frame {
            d.rect(
                [x - radius, y - radius, 2.0 * radius, 2.0 * radius],
                fill(solid(rgba(p.glow, 0.45)), "soft-light"),
            );
        }
        d.rect(
            [x - radius, y - radius, 2.0 * radius, 2.0 * radius],
            fill(
                solid(rgba(p.core, 0.7 * hit(t, c.cues[bi], 20.0))),
                "lighter",
            ),
        );
    }
    // The original restore checks the image-recording threshold before popping
    // the disc clip. Do not rewrite that already-created clip when it flushes.
    recording.restore();
    d.clip = None;
    d.operations = recording.operations();
    d.path(
        circle(x, y, radius),
        vec![source_stroke(solid(rgba(p.hi, 0.9)), 2.0)],
    );
    Ok(())
}
pub(super) fn recap(
    d: &mut Draw,
    a: &TitleRiff,
    c: &Clock,
    s: &State,
    p: &Palette,
    images: &mv_image_dimensions::Context,
    labels: &[Label],
    fonts: &mv_font_metrics::Context,
    recording: &mut Recording,
) -> Result<(), String> {
    let panels = panels(a, c, s);
    let panel_labels: Vec<_> = labels.iter().filter(|v| v.layer == 1).collect();
    recording.save(&[]); // recapPanels' shared alpha scope
    for (i, panel) in panels.iter().enumerate() {
        let item = &a.recap.as_ref().expect("validated recap")[panel.item];
        let size = images.image(&item.bg)?;
        let alpha = (1.0 - s.exit) * if panel.lit { 1.0 } else { 0.42 };
        recording.save(&[
            Operation::Translate {
                offset: panel.position,
            },
            Operation::Scale {
                factors: [panel.scale, panel.scale],
            },
        ]);
        recording.save(&[]); // panel clip retains its creation-time matrix
        d.operations = recording.operations();
        d.clip = Some(Clip {
            transform: IDENTITY,
            operations: d.operations.clone(),
            path: rect_path([-116.0, -65.0, 232.0, 130.0]),
        });
        let scale = (232.0 / size.width as f64).max(130.0 / size.height as f64) * 1.08;
        images::image(
            d,
            &item.bg,
            [
                -(size.width as f64) * scale / 2.0,
                -(size.height as f64) * scale / 2.0,
                size.width as f64 * scale,
                size.height as f64 * scale,
            ],
            "source-over",
            alpha,
            "low",
        );
        recording.resource(&item.bg, [size.width, size.height])?;
        if let Some(character) = &item.character {
            images::sprite(
                d,
                character,
                [0.0, 71.5],
                130.0 * item.h * 0.62,
                [0.5, 1.0],
                0.0,
                1.0,
                alpha,
                images,
                recording,
            )?;
        }
        recording.access(); // next fillRect, also when no character is present
        d.operations = recording.operations();
        let mut flash = fill(
            solid(rgba(p.core, 0.8 * hit(c.time, panel.beat, 18.0))),
            "lighter",
        );
        flash.opacity = alpha;
        d.rect([-116.0, -65.0, 232.0, 130.0], flash);
        recording.restore();
        d.clip = None;
        d.operations = recording.operations();
        let mut border = source_stroke(solid(rgba(p.hi, if panel.lit { 0.95 } else { 0.6 })), 1.5);
        border.opacity = alpha;
        d.rect([-116.0, -65.0, 232.0, 130.0], border);
        recording.restore();
        d.operations = recording.operations();
        super::text::draw(d, panel_labels[i], fonts)?;
    }
    recording.restore();
    d.operations = recording.operations();
    Ok(())
}

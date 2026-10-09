use super::{
    clock::Clock,
    ease::{ease, jsround},
    math::*,
    model::{Easing, Ruby, TitleRiff},
    plan::Operation,
    state::State,
};
use crate::mv_recipe::model::Color;

pub(super) struct Label {
    pub font: String,
    pub text: String,
    pub size: f64,
    pub tracking: f64,
    pub position: [f64; 2],
    pub opacity: f64,
    pub color: Color,
    pub align: &'static str,
    pub baseline: &'static str,
    pub operations: Vec<Operation>,
    pub hud: bool,
    pub layer: u8,
}
pub(super) fn plain(text: &str) -> String {
    text.replace('Ō', "O").replace('ō', "o")
}
pub(super) fn timecode(t: f64) -> String {
    let t = t.max(0.0);
    let seconds = (t + 1e-6).floor() as u64;
    format!(
        "17:{:02}:{:02}.{:02}",
        42 + seconds / 60,
        seconds % 60,
        ((t * 30.0 + 1e-6) % 30.0).floor() as u64
    )
}
pub(super) fn scramble(text: &str, t: f64, start: f64, seed: f64) -> String {
    let k = (t - start) * 30.0;
    if k <= 0.0 {
        return String::new();
    }
    let pool: Vec<char> = "0123456789ABCDEFXZ#%+=/<>ｱｳｶｻﾀﾅﾊﾏﾗ・:".chars().collect();
    let n = k.floor() as usize;
    let q = (t * 24.0 + 1e-6).floor();
    text.chars()
        .take(n.saturating_add(3))
        .enumerate()
        .map(|(i, ch)| {
            if i < n || ch == ' ' {
                ch
            } else {
                pool[hash(&[i as f64, q, seed]) as usize % pool.len()]
            }
        })
        .collect()
}
fn hud(
    a: &TitleRiff,
    text: String,
    pos: [f64; 2],
    size: f64,
    color: Color,
    opacity: f64,
    align: &'static str,
    operations: Vec<Operation>,
    layer: u8,
) -> Label {
    Label {
        font: a.fonts.hud.clone(),
        text,
        size,
        tracking: 0.0,
        position: pos,
        color,
        opacity,
        align,
        baseline: "alphabetic",
        operations,
        hud: true,
        layer,
    }
}
pub(super) struct Panel {
    pub item: usize,
    pub beat: f64,
    pub lit: bool,
    pub position: [f64; 2],
    pub scale: f64,
}
pub(super) fn panels(a: &TitleRiff, c: &Clock, s: &State) -> Vec<Panel> {
    if !a.outro() || c.time < c.at(a.cues.lock) - 0.02 || s.exit >= 1.0 {
        return Vec::new();
    }
    let count = a.recap.as_ref().expect("validated outro recap").len();
    let current = (0..a.cues.exit - a.cues.lock)
        .filter(|k| c.time >= c.at(a.cues.lock + k) - 0.02)
        .last();
    let Some(current) = current else {
        return Vec::new();
    };
    [
        -std::f64::consts::PI + 0.7,
        -0.7,
        0.7,
        std::f64::consts::PI - 0.7,
    ]
    .into_iter()
    .enumerate()
    .filter_map(|(slot, angle)| {
        let last = (slot as i8..=current).step_by(4).last()?;
        let beat = c.at(a.cues.lock + last);
        let lit = last == current;
        Some(Panel {
            item: (a.cues.lock as usize + last as usize + 5) % count,
            beat,
            lit,
            position: [s.x + angle.cos() * 575.0, s.y + angle.sin() * 575.0],
            scale: lerp(0.82, 1.0, ease(clamp((c.time - beat) / 0.28), Easing::Out))
                * if lit { 1.0 } else { 0.94 },
        })
    })
    .collect()
}
pub(super) fn labels(a: &TitleRiff, c: &Clock, s: &State, hi: Color, glow: Color) -> Vec<Label> {
    let t = c.time;
    let q = a.cues;
    let mut out = Vec::new();
    let fade = 1.0 - s.exit;
    let degrees = ease(seg(t, c.at(q.sun) + 0.12 + 0.25, 0.55), Easing::Out);
    if t >= c.at(q.sun) && fade > 0.0 && degrees > 0.99 && s.lock < 0.99 {
        let rot = c
            .cues
            .iter()
            .filter(|b| t >= **b)
            .map(|b| {
                let k = clamp((t - b) / 0.2) - 1.0;
                1.0 + 3.2 * k * k * k + 2.2 * k * k
            })
            .sum::<f64>()
            * (TAU / 48.0);
        for n in 0..4 {
            let angle = rot + n as f64 * std::f64::consts::FRAC_PI_2;
            let radius = s.radius * 1.34 + 32.0;
            let mut ops = s.camera.clone();
            ops.push(Operation::Translate {
                offset: [s.x + angle.cos() * radius, s.y + angle.sin() * radius],
            });
            ops.push(Operation::Rotate {
                radians: angle + std::f64::consts::FRAC_PI_2,
            });
            out.push(hud(
                a,
                format!("{:03}", n * 90),
                [0.0, 5.0],
                13.0,
                hi,
                0.6 * fade * (1.0 - s.lock),
                "center",
                ops,
                0,
            ));
        }
    }
    for panel in panels(a, c, s) {
        let clock = timecode(panel.beat);
        let label = format!("#{:02}  {}", panel.item + 1, &clock[3..8]);
        out.push(hud(
            a,
            label,
            [panel.position[0] - 116.0, panel.position[1] + 83.0],
            13.0,
            hi,
            (if panel.lit { 0.8 } else { 0.4 }) * fade * fade,
            "left",
            s.camera.clone(),
            1,
        ));
    }
    let lock = c.at(q.lock);
    let alpha = 1.0 - ease(seg(t, c.at(q.exit), 0.3), Easing::Out);
    if t >= lock && alpha > 0.0 {
        if let Ruby::Pair(ruby) = &a.ruby {
            let mut index = 0;
            for (group, reading) in ruby.iter().enumerate() {
                let count = reading.chars().count();
                for (i, ch) in reading.chars().enumerate() {
                    let k = ease(seg(t, lock + 0.12 + index as f64 * 0.06, 0.45), Easing::Out);
                    index += 1;
                    if k <= 0.0 {
                        continue;
                    }
                    let x = jsround(
                        if group == 0 { 490.0 } else { 1430.0 }
                            + (i as f64 - (count as f64 - 1.0) / 2.0) * 2.0 * 34.0 * 0.62,
                    );
                    out.push(Label {
                        font: a.fonts.ruby.clone(),
                        text: ch.to_string(),
                        size: 34.0,
                        tracking: 0.0,
                        position: [x, 258.0 + 16.0 * (1.0 - k)],
                        opacity: alpha * k,
                        color: glow,
                        align: "center",
                        baseline: "middle",
                        operations: Vec::new(),
                        hud: false,
                        layer: 2,
                    });
                }
            }
        }
        let k = ease(seg(t, lock + 0.3, 1.4), Easing::Out);
        if k > 0.0 {
            out.push(Label {
                font: a.fonts.subtitle.clone(),
                text: a.sub.clone(),
                size: 28.0,
                tracking: format!("{:.1}", lerp(46.0, 14.0, k))
                    .parse()
                    .expect("finite tracking"),
                position: [960.0 + lerp(23.0, 7.0, k), 874.0],
                opacity: alpha * clamp(k * 2.0),
                color: hi,
                align: "center",
                baseline: "middle",
                operations: Vec::new(),
                hud: false,
                layer: 2,
            });
        }
        let k = ease(seg(t, lock + 0.55, 0.9), Easing::Out);
        if k > 0.0 && !a.credit.is_empty() {
            out.push(Label {
                font: a.fonts.ruby.clone(),
                text: a.credit.clone(),
                size: 25.0,
                tracking: format!("{:.1}", lerp(18.0, 4.0, k))
                    .parse()
                    .expect("finite tracking"),
                position: [962.0, 958.0 + 10.0 * (1.0 - k)],
                opacity: alpha * clamp(k * 1.4) * 0.9,
                color: hi,
                align: "center",
                baseline: "middle",
                operations: Vec::new(),
                hud: false,
                layer: 2,
            });
        }
    }
    if fade > 0.0 {
        let t1 = c.at(q.hud);
        let t2 = c.at(q.hud2);
        let bar = format!("BAR {:03} · {}/4", (c.bar + 1).max(0), c.in_bar + 1);
        let clock = format!("{} / {}", a.hud.len, timecode(t));
        let title = if a.outro() {
            format!("END TITLE · {:02}/12", c.recap_index() % 12 + 1)
        } else {
            "MAIN TITLE".into()
        };
        let rows = [
            (&a.hud.title, 96.0, 78.0, 20.0, 0.8, false, false, t1),
            (&a.hud.when, 96.0, 104.0, 16.0, 0.6, false, true, t1 + 0.12),
            (&a.hud.bpm, 1824.0, 78.0, 20.0, 0.8, true, false, t1 + 0.05),
            (&bar, 1824.0, 104.0, 16.0, 0.6, true, true, t1 + 0.18),
            (&a.hud.geo, 96.0, 1010.0, 18.0, 0.7, false, false, t2),
            (&a.hud.place, 96.0, 984.0, 16.0, 0.55, false, true, t2 + 0.1),
            (&clock, 1824.0, 1010.0, 18.0, 0.7, true, false, t2 + 0.05),
            (&title, 1824.0, 984.0, 16.0, 0.55, true, true, t2 + 0.15),
        ];
        for (i, (text, x, y, size, alpha, right, gl, start)) in rows.into_iter().enumerate() {
            out.push(hud(
                a,
                scramble(text, t, start, i as f64 + 1.0),
                [x, y],
                size,
                if gl { glow } else { hi },
                alpha * fade,
                if right { "right" } else { "left" },
                Vec::new(),
                3,
            ));
        }
    }
    out
}

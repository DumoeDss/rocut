use super::{
    math::*,
    plan::{Action as A, Command, Draw},
};
pub struct Runner {
    pub x: f64,
    pub y: f64,
    pub h: f64,
    pub rot: f64,
    pub sy: f64,
    pub amp: f64,
    pub ft: f64,
}
pub fn columns(d: &mut Draw, id: &str, size: [u32; 2], o: &Runner) -> (f64, f64) {
    let scale = o.h / size[1] as f64;
    let w = size[0] as f64 * scale;
    let x0 = -w * 0.235;
    let y0 = -o.h * 0.985;
    d.a(A::Save);
    d.a(A::Translate { offset: [o.x, o.y] });
    d.a(A::Rotate { radians: o.rot });
    d.a(A::Scale {
        factors: [1.0, o.sy],
    });
    d.asset(
        id,
        Some([0.0, 0.0, size[0] as f64 * 0.56 + 1.0, size[1] as f64]),
        [x0, y0, w * 0.56 + scale, o.h],
        false,
    );
    for i in 0..56 {
        let u0 = 0.56 + (1.0 - 0.56) * i as f64 / 56.0;
        let u1 = 0.56 + (1.0 - 0.56) * (i + 1) as f64 / 56.0;
        let k = (u0 - 0.56) / (1.0 - 0.56);
        let dy = o.amp * k * k * (k * 5.2 - o.ft * 7.5).sin()
            + o.amp * 0.3 * k * (o.ft * 2.3 + k * 2.0).sin();
        d.asset(
            id,
            Some([
                u0 * size[0] as f64,
                0.0,
                (u1 - u0) * size[0] as f64 + 0.6,
                size[1] as f64,
            ]),
            [x0 + u0 * w, y0 + dy, (u1 - u0) * w + 0.6, o.h],
            false,
        );
    }
    d.a(A::Restore);
    (w, o.x - w * 0.235)
}
pub fn lit(d: &mut Draw, id: &str, size: [u32; 2], o: &Runner, foot_y: f64) {
    d.surface("road-runner", [1920, 1080]);
    d.target = "road-runner";
    let (w, x0) = columns(d, id, size, o);
    d.a(A::Composite {
        value: "source-atop",
    });
    d.fill([34.0, 22.0, 58.0], 0.30);
    d.rect([0.0, 0.0, 1920.0, 1080.0]);
    d.linear(
        [0.0, o.y],
        [0.0, o.y - o.h * 0.6],
        &[
            (0.0, [255.0, 236.0, 210.0], 0.34),
            (1.0, [255.0, 236.0, 210.0], 0.0),
        ],
    );
    d.rect([0.0, o.y - o.h, 1920.0, o.h + 40.0]);
    d.linear(
        [x0, 0.0],
        [x0 + w * 0.7, 0.0],
        &[
            (0.0, [255.0, 190.0, 140.0], 0.24),
            (1.0, [255.0, 190.0, 140.0], 0.0),
        ],
    );
    d.rect([0.0, 0.0, 1920.0, 1080.0]);
    d.a(A::Composite {
        value: "source-over",
    });
    d.surface("road-reflection", [1920, 1080]);
    d.target = "road-reflection";
    d.a(A::Save);
    d.a(A::Translate {
        offset: [0.0, foot_y * 2.0 + 6.0],
    });
    d.a(A::Scale {
        factors: [1.0, -1.0],
    });
    d.image("road-runner", None, [0.0, 0.0, 1920.0, 1080.0], true);
    d.a(A::Restore);
    d.a(A::Composite {
        value: "destination-in",
    });
    d.linear(
        [0.0, foot_y],
        [0.0, foot_y + o.h * 0.45],
        &[(0.0, [0.0, 0.0, 0.0], 0.5), (1.0, [0.0, 0.0, 0.0], 0.0)],
    );
    d.rect([0.0, 0.0, 1920.0, 1080.0]);
    d.target = "main";
    d.a(A::Save);
    d.a(A::Alpha { value: 0.55 });
    d.image("road-reflection", None, [0.0, 0.0, 1920.0, 1080.0], true);
    d.a(A::Restore);
    d.release("road-reflection");
    // Exact native source-in tint of admitted art; no matte approximation.
    d.surface("road-rim-tint", size);
    d.target = "road-rim-tint";
    d.asset(id, None, [0.0, 0.0, size[0] as f64, size[1] as f64], true);
    d.a(A::Composite { value: "source-in" });
    d.fill([255.0, 176.0, 112.0], 1.0);
    d.rect([0.0, 0.0, size[0] as f64, size[1] as f64]);
    d.target = "main";
    d.a(A::Save);
    d.a(A::Composite { value: "lighter" });
    d.a(A::Filter { blur_px: 3.0 });
    d.a(A::Save);
    d.a(A::Smoothing { quality: "high" });
    d.a(A::Translate {
        offset: [o.x - 5.0, o.y - 2.0],
    });
    d.a(A::Rotate { radians: o.rot });
    d.a(A::Scale {
        factors: [1.0, 1.0],
    });
    d.image(
        "road-rim-tint",
        None,
        [-w * 0.235, -o.h * 0.985, w, o.h],
        false,
    );
    d.a(A::Restore);
    d.a(A::Restore);
    d.release("road-rim-tint");
    d.image("road-runner", None, [0.0, 0.0, 1920.0, 1080.0], true);
    d.commands.push(Command::Foreground {
        surface: "road-runner",
    });
    d.release("road-runner");
}

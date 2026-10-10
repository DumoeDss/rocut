#[derive(Clone, Copy)]
pub struct Camera {
    pub pos: [f64; 3],
    pub yaw: f64,
    pub pitch: f64,
    pub f: f64,
    pub yh: f64,
}
impl Camera {
    pub fn new(pos: [f64; 3], yaw: f64, pitch: f64, f: f64) -> Self {
        Self {
            pos,
            yaw,
            pitch,
            f,
            yh: 540.0 - f * pitch.tan(),
        }
    }
    pub fn cam(&self, p: [f64; 3]) -> [f64; 3] {
        let dx = p[0] - self.pos[0];
        let dy = p[1] - self.pos[1];
        let dz = p[2] - self.pos[2];
        let x1 = dx * self.yaw.cos() - dz * self.yaw.sin();
        let z1 = dx * self.yaw.sin() + dz * self.yaw.cos();
        [
            x1,
            dy * self.pitch.cos() + z1 * self.pitch.sin(),
            -dy * self.pitch.sin() + z1 * self.pitch.cos(),
        ]
    }
    pub fn p(&self, p: [f64; 3]) -> Option<[f64; 3]> {
        let c = self.cam(p);
        if c[2] < 0.05 {
            return None;
        }
        Some([
            960.0 + self.f * c[0] / c[2],
            540.0 - self.f * c[1] / c[2],
            c[2],
        ])
    }
    pub fn poly(&self, points: &[[f64; 3]]) -> Vec<[f64; 2]> {
        let cp: Vec<_> = points.iter().map(|p| self.cam(*p)).collect();
        let mut out = Vec::new();
        for i in 0..cp.len() {
            let a = cp[i];
            let b = cp[(i + 1) % cp.len()];
            let ain = a[2] > 0.06;
            let bin = b[2] > 0.06;
            if ain {
                out.push(a);
            }
            if ain != bin {
                let k = (0.06 - a[2]) / (b[2] - a[2]);
                out.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, 0.06]);
            }
        }
        out.iter()
            .map(|c| [960.0 + self.f * c[0] / c[2], 540.0 - self.f * c[1] / c[2]])
            .collect()
    }
    pub fn quad(&self, x0: f64, x1: f64, z0: f64, z1: f64) -> Vec<[f64; 2]> {
        self.poly(&[[x0, 0.0, z0], [x1, 0.0, z0], [x1, 0.0, z1], [x0, 0.0, z1]])
    }
    pub fn dir_x(&self, a: f64) -> f64 {
        let x = (a - self.yaw).sin();
        let z = (a - self.yaw).cos();
        if z > 0.02 {
            960.0 + self.f * x / (z * self.pitch.cos())
        } else if x > 0.0 {
            90000.0
        } else {
            -90000.0
        }
    }
}

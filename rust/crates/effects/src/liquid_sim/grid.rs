use super::{Config, Error, State, validation};

pub(super) struct Grid {
    pub nx: usize,
    pub ny: usize,
    pub domain: [f64; 2],
    pub dx: f64,
    pub dy: f64,
}

impl Grid {
    pub fn new(config: &Config, domain: [f64; 2]) -> Result<Self, Error> {
        validation::config(config)?;
        if domain.iter().any(|v| !v.is_finite() || *v < 1.0) || domain[0].min(domain[1]) != 1.0 {
            return Err(Error(
                "liquid domain must be finite and normalized to a unit short side",
            ));
        }
        let dx = domain[0] / f64::from(config.columns);
        let dy = domain[1] / f64::from(config.rows);
        if [dx, dy].iter().any(|h| {
            let coefficient = h.recip().powi(2);
            !h.is_finite() || !coefficient.is_finite() || coefficient == 0.0
        }) {
            return Err(Error(
                "liquid domain spacing exceeds numerical arithmetic range",
            ));
        }
        Ok(Self {
            nx: config.columns as usize,
            ny: config.rows as usize,
            domain,
            dx,
            dy,
        })
    }

    pub fn cells(&self) -> usize {
        self.nx * self.ny
    }
    pub fn u_len(&self) -> usize {
        (self.nx + 1) * self.ny
    }
    pub fn v_len(&self) -> usize {
        self.nx * (self.ny + 1)
    }
    pub fn cell(&self, i: usize, j: usize) -> usize {
        j * self.nx + i
    }
    pub fn u(&self, i: usize, j: usize) -> usize {
        j * (self.nx + 1) + i
    }
    pub fn v(&self, i: usize, j: usize) -> usize {
        j * self.nx + i
    }

    pub fn cell_position(&self, i: usize, j: usize) -> [f64; 2] {
        [(i as f64 + 0.5) * self.dx, (j as f64 + 0.5) * self.dy]
    }

    pub fn u_position(&self, i: usize, j: usize) -> [f64; 2] {
        [i as f64 * self.dx, (j as f64 + 0.5) * self.dy]
    }

    pub fn v_position(&self, i: usize, j: usize) -> [f64; 2] {
        [(i as f64 + 0.5) * self.dx, j as f64 * self.dy]
    }

    pub fn sample_u(&self, values: &[f64], p: [f64; 2]) -> f64 {
        bilinear(
            values,
            self.nx + 1,
            self.ny,
            p[0] / self.dx,
            p[1] / self.dy - 0.5,
        )
    }

    pub fn sample_v(&self, values: &[f64], p: [f64; 2]) -> f64 {
        bilinear(
            values,
            self.nx,
            self.ny + 1,
            p[0] / self.dx - 0.5,
            p[1] / self.dy,
        )
    }

    pub fn sample_cell(&self, values: &[f64], p: [f64; 2]) -> f64 {
        bilinear(
            values,
            self.nx,
            self.ny,
            p[0] / self.dx - 0.5,
            p[1] / self.dy - 0.5,
        )
    }

    pub fn sample_velocity(&self, state: &State, p: [f64; 2]) -> [f64; 2] {
        [self.sample_u(&state.u, p), self.sample_v(&state.v, p)]
    }

    pub fn clamp(&self, p: [f64; 2]) -> Result<[f64; 2], Error> {
        if p.iter().any(|v| !v.is_finite()) {
            return Err(Error(
                "liquid characteristic exceeds numerical arithmetic range",
            ));
        }
        Ok([
            p[0].clamp(0.0, self.domain[0]),
            p[1].clamp(0.0, self.domain[1]),
        ])
    }

    pub fn walls(&self, state: &mut State) {
        for j in 0..self.ny {
            state.u[self.u(0, j)] = 0.0;
            state.u[self.u(self.nx, j)] = 0.0;
        }
        for i in 0..self.nx {
            state.v[self.v(i, 0)] = 0.0;
            state.v[self.v(i, self.ny)] = 0.0;
        }
    }
}

/// Nearest-edge extension gives free slip for each tangential component.
/// Normal components include their fixed zero-valued boundary faces.
pub(super) fn bilinear(values: &[f64], width: usize, height: usize, x: f64, y: f64) -> f64 {
    let x = x.clamp(0.0, (width - 1) as f64);
    let y = y.clamp(0.0, (height - 1) as f64);
    let i = x.floor() as usize;
    let j = y.floor() as usize;
    let next_i = (i + 1).min(width - 1);
    let next_j = (j + 1).min(height - 1);
    let tx = x - i as f64;
    let ty = y - j as f64;
    let low = values[j * width + i] * (1.0 - tx) + values[j * width + next_i] * tx;
    let high = values[next_j * width + i] * (1.0 - tx) + values[next_j * width + next_i] * tx;
    low * (1.0 - ty) + high * ty
}

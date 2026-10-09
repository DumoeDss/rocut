//! Deterministic generators.
//! Every position/opacity is resolved here; the raster adapter has no clock.
use super::catalog::*;
use super::generator_model::*;
use super::transitions::random;
use super::validate::color;

impl GlyphRain {
    pub fn valid(&self) -> bool {
        GLYPH_COLUMNS.valid(self.columns)
            && GLYPH_ROWS.valid(self.rows)
            && GLYPH_TRAIL.valid(self.trail)
            && self.trail <= self.rows
            && self.work() <= GENERATOR_PRIMITIVES
            && (1..=MAX_GLYPHS).contains(&self.glyphs.chars().count())
            && self.glyphs.chars().all(|c| !c.is_control())
            && GLYPH_SPEED.valid(self.speed)
            && DRAWING_FPS.valid(self.drawing_fps)
            && color(&self.color)
            && color(&self.head_color)
            && OPACITY.valid(self.opacity)
    }
    pub fn work(&self) -> u32 {
        self.columns.saturating_mul(self.trail)
    }
    pub fn plan(&self, sample: u64, seed: u32, width: f64, height: f64) -> GlyphRainPlan {
        let cell_width = width / f64::from(self.columns);
        let cell_height = height / f64::from(self.rows);
        let alphabet: Vec<char> = self.glyphs.chars().collect();
        let t = sample as f64 / f64::from(self.drawing_fps);
        let mut glyphs = Vec::new();
        for column in 0..self.columns {
            let velocity = self.speed * (0.75 + random(seed, column * 3) * 0.5);
            let distance =
                t * velocity + random(seed, column * 3 + 1) * f64::from(self.rows + self.trail);
            let head = distance.rem_euclid(f64::from(self.rows + self.trail));
            for tail in 0..self.trail {
                let row = head - f64::from(tail);
                if row < -1.0 || row > f64::from(self.rows) {
                    continue;
                }
                let key = column
                    .wrapping_mul(65537)
                    .wrapping_add(tail * 257)
                    .wrapping_add(distance.floor() as u32);
                let index = (random(seed ^ 0x91e1_0da5, key) * alphabet.len() as f64) as usize;
                glyphs.push(Glyph {
                    text: alphabet[index].to_string(),
                    x: (f64::from(column) + 0.5) * cell_width,
                    y: (row + 0.5) * cell_height,
                    opacity: self.opacity * (1.0 - f64::from(tail) / f64::from(self.trail)).powi(2),
                    head: tail == 0,
                });
            }
        }
        GlyphRainPlan {
            font: self.font.clone(),
            font_size: cell_height * 0.9,
            cell_width,
            color: self.color,
            head_color: self.head_color,
            glyphs,
        }
    }
}

impl ParticleReveal {
    pub fn valid(&self) -> bool {
        PARTICLE_GRID.valid(self.columns)
            && PARTICLE_GRID.valid(self.rows)
            && self.work() <= GENERATOR_PRIMITIVES
            && self.rect[..2].iter().all(|v| RECT_ORIGIN.valid(*v))
            && self.rect[2..].iter().all(|v| RECT_SIZE.valid(*v))
            && SCATTER.valid(self.scatter)
            && STAGGER.valid(self.stagger)
            && SPIN.valid(self.spin)
            && START_SCALE.valid(self.start_scale)
            && OPACITY.valid(self.opacity)
    }
    pub fn work(&self) -> u32 {
        self.columns.saturating_mul(self.rows)
    }
    pub fn plan(&self, progress: f64, seed: u32, width: f64, height: f64) -> ParticleRevealPlan {
        let p = match self.direction {
            Direction::In => progress,
            Direction::Out => 1.0 - progress,
        };
        let mut particles = Vec::new();
        if p > 0.0 && p < 1.0 && self.opacity > 0.0 {
            for row in 0..self.rows {
                for column in 0..self.columns {
                    let key = (row * self.columns + column) * 4;
                    let delay = random(seed, key) * self.stagger;
                    let local = ((p - delay) / (1.0 - delay)).clamp(0.0, 1.0);
                    if local <= 0.0 {
                        continue;
                    }
                    let remaining = (1.0 - local).powi(3);
                    let angle = random(seed, key + 1) * std::f64::consts::TAU;
                    let distance = (0.25 + random(seed, key + 2) * 0.75) * self.scatter * remaining;
                    particles.push(Particle {
                        uv: [
                            f64::from(column) / f64::from(self.columns),
                            f64::from(row) / f64::from(self.rows),
                            1.0 / f64::from(self.columns),
                            1.0 / f64::from(self.rows),
                        ],
                        offset: [
                            angle.cos() * distance * width,
                            angle.sin() * distance * height,
                        ],
                        scale: 1.0 - (1.0 - self.start_scale) * remaining,
                        rotation: (random(seed, key + 3) * 2.0 - 1.0)
                            * self.spin
                            * std::f64::consts::TAU
                            * remaining,
                        opacity: self.opacity * local,
                    });
                }
            }
        }
        ParticleRevealPlan {
            image: self.image.clone(),
            rect: [
                self.rect[0] * width,
                self.rect[1] * height,
                self.rect[2] * width,
                self.rect[3] * height,
            ],
            fit: self.fit,
            opacity: self.opacity,
            full_image: p >= 1.0,
            particles,
        }
    }
}

use super::{
    model::{Effect, Post},
    post_model::PostStage,
    validate::{color, range},
};
use std::collections::BTreeSet;

impl Post {
    pub fn valid_target(&self) -> bool {
        match self.stage {
            PostStage::Role => {
                !self.roles.is_empty()
                    && self.roles.len() <= 4
                    && self.roles.iter().collect::<BTreeSet<_>>().len() == self.roles.len()
            }
            // Composite post applies once to exactly the selected recipe output.
            // A roles subset would imply a second, ambiguous compositing graph.
            PostStage::Composite => self.roles.is_empty(),
        }
    }

    pub fn render_passes(&self) -> usize {
        let surfaces = match self.stage {
            PostStage::Role => self.roles.len(),
            PostStage::Composite => 1,
        };
        surfaces * self.effects.iter().map(Effect::passes).sum::<usize>()
    }
}

impl Effect {
    /// Lower after amount automation/audio evaluation. Keep authored order and
    /// reuse the existing straight-alpha color chain without extra quantization.
    pub fn lower(self) -> Self {
        let grade = |lift, gain| Self::Grade {
            exposure: 0.0,
            contrast: 1.0,
            saturation: 1.0,
            lift,
            gain,
        };
        match self {
            Self::Invert { amount } => grade([amount; 3], [1.0 - amount; 3]),
            Self::Flash { amount, color } => {
                let lift = color.map(|v| amount * v);
                grade(lift, lift.map(|v| 1.0 - amount + v))
            }
            Self::Fade { amount } => grade([0.0; 3], [1.0 - amount; 3]),
            other => other,
        }
    }

    pub fn valid(&self) -> bool {
        let rate = |fps: u32| fps > 0 && fps <= 120;
        let center = |c: &[f64; 2]| c.iter().all(|v| range(*v, 0.0, 1.0));
        match self {
            Self::LightLeak { amount, speed, .. } => {
                range(*amount, 0.0, 1.0) && range(*speed, 0.0, 8.0)
            }
            Self::Invert { amount }
            | Self::Fade { amount }
            | Self::QuantizationDither { amount } => range(*amount, 0.0, 1.0),
            Self::Flash { amount, color } => {
                range(*amount, 0.0, 1.0) && color.iter().all(|v| range(*v, 0.0, 1.0))
            }
            Self::Letterbox {
                amount,
                height_fraction,
            } => range(*amount, 0.0, 1.0) && range(*height_fraction, 0.0, 0.5),
            Self::Grade {
                exposure,
                contrast,
                saturation,
                lift,
                gain,
            } => {
                range(*exposure, -8.0, 8.0)
                    && range(*contrast, 0.0, 4.0)
                    && range(*saturation, 0.0, 4.0)
                    && lift.iter().all(|v| range(*v, -1.0, 1.0))
                    && gain.iter().all(|v| range(*v, 0.0, 4.0))
            }
            Self::Palette { colors, mix } => {
                (2..=16).contains(&colors.len())
                    && colors.iter().all(|c| color(c) && c[3] == 1.0)
                    && range(*mix, 0.0, 1.0)
            }
            Self::Vignette { amount } => range(*amount, 0.0, 1.0),
            Self::Grain { amount, fps } => range(*amount, 0.0, 1.0) && rate(*fps),
            Self::LineBoil {
                amount,
                cell_size,
                fps,
            } => range(*amount, 0.0, 32.0) && range(*cell_size, 4.0, 256.0) && rate(*fps),
            Self::Glitch { amount, bands, fps } => {
                range(*amount, 0.0, 1.0) && (2..=256).contains(bands) && rate(*fps)
            }
            Self::ChromaticAberration { amount, center: c } => {
                range(*amount, 0.0, 64.0) && center(c)
            }
            Self::ZoomBlur { amount, center: c } => range(*amount, 0.0, 1.0) && center(c),
            Self::Bloom {
                amount,
                threshold,
                radius,
                ..
            } => {
                range(*amount, 0.0, 4.0) && range(*threshold, 0.0, 1.0) && range(*radius, 1.0, 64.0)
            }
        }
    }

    pub fn sampling_rate(&self) -> Option<u32> {
        match self {
            Self::Grain { fps, .. } | Self::LineBoil { fps, .. } | Self::Glitch { fps, .. } => {
                Some(*fps)
            }
            _ => None,
        }
    }

    pub fn spatial(&self) -> bool {
        matches!(
            self,
            Self::LineBoil { .. }
                | Self::Glitch { .. }
                | Self::ChromaticAberration { .. }
                | Self::ZoomBlur { .. }
                | Self::Bloom { .. }
        )
    }

    pub fn passes(&self) -> usize {
        if let Self::LightLeak { alpha, .. } = self {
            return match alpha {
                super::light_leak::Alpha::Preserve => 3,
                super::light_leak::Alpha::Expand => 2,
            };
        }
        // Three extraction/downsample + six separable blur + final composite.
        if matches!(self, Self::Bloom { .. }) {
            10
        } else {
            1
        }
    }

    /// Additional reusable RGBA8-equivalent raster scratch, not process RSS.
    pub fn light_leak_scratch(&self) -> u64 {
        match self {
            Self::LightLeak {
                alpha: super::light_leak::Alpha::Preserve,
                ..
            } => 2,
            Self::LightLeak {
                alpha: super::light_leak::Alpha::Expand,
                ..
            } => 1,
            _ => 0,
        }
    }
}

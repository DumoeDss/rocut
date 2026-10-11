use super::model::{Scene, Span};

impl Scene {
    /// Authored local shot intervals, never cross-project or caller candidates.
    pub(super) fn shot_span(&self) -> Option<&Span> {
        match self {
            Self::Jz { span, .. }
            | Self::PanelsNative { span, .. }
            | Self::Freeze { span, .. }
            | Self::Rewind { span, .. }
            | Self::Melt { span, .. }
            | Self::IllustNative { span, .. }
            | Self::Burst { span, .. }
            | Self::Night { span, .. }
            | Self::Memories { span, .. }
            | Self::HeartShatter { span, .. }
            | Self::HeartShatterBurn { span, .. }
            | Self::HeartGather { span, .. }
            | Self::SunBloom { span, .. }
            | Self::SkyShatter { span, .. }
            | Self::Road { span, .. }
            | Self::Tunnel { span, .. }
            | Self::Ink { span, .. }
            | Self::Flame { span, .. }
            | Self::Fall { span, .. }
            | Self::Thread { span, .. }
            | Self::KanjiSlam { span, .. }
            | Self::TitleRiff { span, .. }
            | Self::Ember { span, .. }
            | Self::Converge { span, .. }
            | Self::TypeCard { span, .. }
            | Self::Afterimage { span, .. }
            | Self::Cloth { span, .. }
            | Self::Shatter { span, .. }
            | Self::Grid { span, .. }
            | Self::HexFloat { span, .. }
            | Self::AsciiSweep { span, .. }
            | Self::ParticleScroll { span, .. }
            | Self::ParticleReveal { span, .. }
            | Self::Transition { span, .. } => Some(span),
            Self::Illust { motion, .. } => Some(motion),
            _ => None,
        }
    }
    pub(super) fn is_reference_wrapper(&self) -> bool {
        matches!(
            self,
            Self::PanelsNative { .. }
                | Self::Freeze { .. }
                | Self::Rewind { .. }
                | Self::Melt { .. }
                | Self::Ref { .. }
                | Self::Sequence { .. }
                | Self::Layers { .. }
                | Self::Panels { .. }
                | Self::Transition { .. }
        )
    }
}

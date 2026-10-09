use super::evaluate::{Clock, progress};
use super::model::{PlanNode, Scene};

pub(super) fn resolve(scene: &Scene, clock: Clock<'_>) -> Result<Option<PlanNode>, String> {
    Ok(Some(match scene {
        Scene::Cloth {
            role,
            settings,
            span,
        } => PlanNode::Cloth {
            role: *role,
            data: settings.plan(
                clock.elapsed(span)?,
                clock.seed,
                clock.width as u32,
                clock.height as u32,
                clock
                    .resources
                    .iter()
                    .find(|r| r.id == settings.image && r.kind == "image")
                    .ok_or("MV Cloth requires its declared image resource")?,
            )?,
        },
        Scene::Shatter {
            role,
            settings,
            span,
            easing,
        } => PlanNode::Shatter {
            role: *role,
            data: settings.plan(
                progress(clock.frame as f64, span, *easing),
                clock.seed,
                clock.width,
                clock.height,
            ),
        },
        Scene::Grid {
            role,
            settings,
            span,
            easing,
        } => PlanNode::Grid {
            role: *role,
            data: settings.plan(
                progress(clock.frame as f64, span, *easing),
                clock.seed,
                clock.width,
                clock.height,
            ),
        },
        Scene::HexFloat {
            role,
            settings,
            span,
            easing,
        } => PlanNode::HexFloat {
            role: *role,
            data: settings.plan(
                progress(clock.frame as f64, span, *easing),
                clock.seed,
                clock.width,
                clock.height,
            ),
        },
        Scene::AsciiSweep {
            role,
            settings,
            span,
            easing,
        } => PlanNode::AsciiSweep {
            role: *role,
            data: settings.plan(
                progress(clock.frame as f64, span, *easing),
                clock.seed,
                clock.width,
                clock.height,
            ),
        },
        Scene::ParticleScroll {
            role,
            settings,
            span,
            easing,
        } => PlanNode::ParticleScroll {
            role: *role,
            data: settings.plan(
                progress(clock.frame as f64, span, *easing),
                clock.seed,
                clock.width,
                clock.height,
            ),
        },
        Scene::GlyphRain { role, settings } => PlanNode::GlyphRain {
            role: *role,
            data: settings.plan(
                clock.sample(settings.drawing_fps),
                clock.seed,
                clock.width,
                clock.height,
            ),
        },
        Scene::ParticleReveal {
            role,
            settings,
            span,
            easing,
        } => PlanNode::ParticleReveal {
            role: *role,
            data: settings.plan(
                progress(clock.frame as f64, span, *easing),
                clock.seed,
                clock.width,
                clock.height,
            ),
        },
        _ => return Ok(None),
    }))
}

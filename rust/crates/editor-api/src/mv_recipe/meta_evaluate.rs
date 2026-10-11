use super::{Clock, PlanNode, Recipe, Scene, Span};
use crate::mv_recipe::meta_reference::{self as meta, Sample, ShotCandidate};

fn sample<'a>(clock: Clock<'a>, span: &Span) -> Result<Sample<'a>, String> {
    let s = clock.ember_sample(span)?;
    Ok(Sample {
        song_ticks: s.song_ticks,
        shot_start_ticks: s.shot_start_ticks,
        shot_end_ticks: s.shot_end_ticks,
        analysis: clock.audio,
    })
}

fn child(recipe: &Recipe, child: &meta::ChildSample, clock: Clock<'_>) -> Result<PlanNode, String> {
    recipe.node(&child.input, clock.remap_song_ticks(child.song_ticks)?)
}

pub(super) fn resolve(
    recipe: &Recipe,
    scene: &Scene,
    id: &str,
    clock: Clock<'_>,
) -> Result<Option<PlanNode>, String> {
    Ok(Some(match scene {
        Scene::PanelsNative {
            role,
            settings,
            bpm,
            span,
        } => {
            let s = sample(clock, span)?;
            if clock.font_requests.is_some() {
                for c in settings
                    .child_samples(&s, *bpm, clock.width as u32, clock.height as u32)?
                    .into_iter()
                    .flatten()
                {
                    child(recipe, &c, clock)?;
                }
                return Ok(Some(PlanNode::Empty));
            }
            let data = settings.plan(&s, *bpm, clock.width as u32, clock.height as u32)?;
            let inputs = data
                .panels
                .iter()
                .map(|p| {
                    p.child
                        .as_ref()
                        .map(|c| child(recipe, c, clock).map(Box::new))
                        .transpose()
                })
                .collect::<Result<Vec<_>, String>>()?;
            PlanNode::PanelsNative {
                role: *role,
                inputs,
                data,
            }
        }
        Scene::Freeze {
            role,
            input,
            span,
            settings,
        } => {
            let s = sample(clock, span)?;
            if clock.font_requests.is_some() {
                child(recipe, &settings.child_sample(input, &s)?, clock)?;
                return Ok(Some(PlanNode::Empty));
            }
            let data = settings.plan(input, &s, clock.width as u32, clock.height as u32)?;
            PlanNode::Freeze {
                role: *role,
                input: Box::new(child(recipe, &data.child, clock)?),
                data,
            }
        }
        Scene::Melt {
            role,
            input,
            span,
            settings,
        } => {
            let s = sample(clock, span)?;
            if clock.font_requests.is_some() {
                child(recipe, &settings.child_sample(input, &s)?, clock)?;
                return Ok(Some(PlanNode::Empty));
            }
            let data = settings.plan(input, &s, clock.width as u32, clock.height as u32)?;
            PlanNode::Melt {
                role: *role,
                input: Box::new(child(recipe, &data.child, clock)?),
                data,
            }
        }
        Scene::Rewind {
            role,
            input,
            span,
            settings,
        } => {
            let s = sample(clock, span)?;
            let candidates = recipe
                .nodes
                .iter()
                .map(|node| {
                    let start = node.scene.shot_span().map_or(0, |s| s.start_frame);
                    Ok(ShotCandidate {
                        input: &node.id,
                        start_ticks: u64::from(start)
                            .checked_mul(clock.step)
                            .and_then(|t| t.checked_add(clock.song_start_ticks))
                            .ok_or("Rewind candidate clock overflow")?,
                        is_reference: node.scene.is_reference_wrapper(),
                    })
                })
                .collect::<Result<Vec<_>, String>>()?;
            if clock.font_requests.is_some() {
                if let Some(c) = settings.child_sample(input, id, &s, &candidates)? {
                    child(recipe, &c, clock)?;
                }
                return Ok(Some(PlanNode::Empty));
            }
            let data = settings.plan(
                input,
                id,
                &s,
                &candidates,
                clock.resources,
                clock.fonts,
                clock.width as u32,
                clock.height as u32,
            )?;
            let input = data
                .child
                .as_ref()
                .map(|c| child(recipe, c, clock).map(Box::new))
                .transpose()?;
            PlanNode::Rewind {
                role: *role,
                input,
                data,
            }
        }
        _ => return Ok(None),
    }))
}

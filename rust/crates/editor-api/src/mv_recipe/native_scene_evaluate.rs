//! Native resource scenes share the evaluator's integer clock and traversal.
use super::{Clock, PlanNode, Scene, Span};
use crate::mv_recipe::kanji_slam;

impl Clock<'_> {
    fn flame_sample(&self, span: &Span) -> Result<crate::mv_recipe::flame::Sample<'_>, String> {
        let sample = self.ember_sample(span)?;
        Ok(crate::mv_recipe::flame::Sample {
            shot_start_ticks: sample.shot_start_ticks,
            shot_end_ticks: sample.shot_end_ticks,
            song_ticks: sample.song_ticks,
            analysis: sample.analysis,
        })
    }
    fn fall_sample(&self, span: &Span) -> Result<crate::mv_recipe::fall::Sample<'_>, String> {
        let sample = self.ember_sample(span)?;
        Ok(crate::mv_recipe::fall::Sample {
            shot_start_ticks: sample.shot_start_ticks,
            shot_end_ticks: sample.shot_end_ticks,
            song_ticks: sample.song_ticks,
            analysis: sample.analysis,
        })
    }
    fn thread_sample(&self, span: &Span) -> Result<crate::mv_recipe::thread::Sample<'_>, String> {
        let sample = self.ember_sample(span)?;
        Ok(crate::mv_recipe::thread::Sample {
            shot_start_ticks: sample.shot_start_ticks,
            shot_end_ticks: sample.shot_end_ticks,
            song_ticks: sample.song_ticks,
            analysis: sample.analysis,
        })
    }
    fn kanji_sample(&self, span: &Span) -> Result<kanji_slam::Sample<'_>, String> {
        let sample = self.ember_sample(span)?;
        Ok(kanji_slam::Sample {
            shot_start_ticks: sample.shot_start_ticks,
            shot_end_ticks: sample.shot_end_ticks,
            song_ticks: sample.song_ticks,
            analysis: sample.analysis,
        })
    }
    fn facts(
        &self,
        kind: &str,
    ) -> Result<
        (
            &crate::mv_font_metrics::Context,
            &crate::mv_image_dimensions::Context,
        ),
        String,
    > {
        Ok((
            self.fonts
                .ok_or_else(|| format!("{kind} requires measured font facts"))?,
            self.images
                .ok_or_else(|| format!("{kind} requires decoded image facts"))?,
        ))
    }
}

pub(super) fn preflight(scene: &Scene, clock: Clock<'_>) -> Result<(), String> {
    match scene {
        Scene::Flame {settings,span,..} => {
            let images=clock.images.ok_or("flame requires decoded image facts")?;
            let start=u64::from(span.start_frame);
            let end=start+u64::from(span.duration_frames);
            let resource_clock=clock.remap(clock.frame.clamp(start,end));
            settings.runtime_ready(&resource_clock.flame_sample(span)?,images,clock.resources)?;
        }
        Scene::Fall { settings, span, .. } => {
            let images = clock.images.ok_or("fall requires decoded image facts")?;
            let start = u64::from(span.start_frame);
            let end = start + u64::from(span.duration_frames);
            let resource_clock = clock.remap(clock.frame.clamp(start, end));
            settings.runtime_ready(&resource_clock.fall_sample(span)?, images)?;
        }
        Scene::Thread { settings, span, .. } => {
            let images = clock.images.ok_or("thread requires decoded image facts")?;
            let start = u64::from(span.start_frame);
            let end = start + u64::from(span.duration_frames);
            let resource_clock = clock.remap(clock.frame.clamp(start, end));
            settings.runtime_ready(&resource_clock.thread_sample(span)?, images)?;
        }
        Scene::Ember { settings, span, .. } => {
            settings.runtime_ready(&clock.ember_sample(span)?)?
        }
        Scene::TitleRiff { settings, span, .. } => {
            let (fonts, images) = clock.facts("titleRiff")?;
            settings.runtime_ready(&clock.title_sample(span)?, fonts, images)?;
        }
        Scene::KanjiSlam { settings, span, .. } => {
            let (fonts, images) = clock.facts("kanjiSlam")?;
            // This pass checks every authored leaf, including hidden future or
            // past shots. Its clock is resource-preflight-only: actual drawing
            // and sampled metric discovery below retain the mapped clock.
            let start = u64::from(span.start_frame);
            let end = start + u64::from(span.duration_frames);
            let resource_clock = clock.remap(clock.frame.clamp(start, end));
            settings.runtime_ready(&resource_clock.kanji_sample(span)?, fonts, images)?;
        }
        _ => {}
    }
    Ok(())
}

/// Return true for leaves during discovery. Structural nodes continue through
/// Recipe::node, preserving reference/sequence clocks and transition endpoints.
pub(super) fn collect_font_requests(scene: &Scene, clock: Clock<'_>) -> Result<bool, String> {
    let Some(requests) = clock.font_requests else {
        return Ok(false);
    };
    match scene {
        Scene::TitleRiff { settings, span, .. } => settings.sampled_requests(
            &clock.title_sample(span)?,
            clock.resources,
            &mut requests.borrow_mut(),
        )?,
        Scene::KanjiSlam { settings, span, .. } => settings.sampled_requests(
            &clock.kanji_sample(span)?,
            clock.resources,
            &mut requests.borrow_mut(),
        )?,
        Scene::Ref { .. }
        | Scene::Sequence { .. }
        | Scene::Panels { .. }
        | Scene::Transition { .. } => return Ok(false),
        _ => {}
    }
    Ok(true)
}

pub(super) fn resolve(scene: &Scene, clock: Clock<'_>) -> Result<Option<PlanNode>, String> {
    Ok(Some(match scene {
        Scene::Flame {role,settings,span} => PlanNode::Flame {
            role:*role,
            data:settings.produce(&clock.flame_sample(span)?,clock.width as u32,clock.height as u32,
                clock.images.ok_or("flame requires decoded image facts")?,clock.resources)?,
        },
        Scene::Fall { role, settings, span } => PlanNode::Fall {
            role: *role,
            data: settings.produce(
                &clock.fall_sample(span)?, clock.width as u32, clock.height as u32,
                clock.images.ok_or("fall requires decoded image facts")?,
            )?,
        },
        Scene::Thread { role, settings, span } => PlanNode::Thread {
            role: *role,
            data: settings.produce(
                &clock.thread_sample(span)?, clock.width as u32, clock.height as u32,
                clock.images.ok_or("thread requires decoded image facts")?,
            )?,
        },
        Scene::TitleRiff {
            role,
            settings,
            span,
        } => {
            let (fonts, images) = clock.facts("titleRiff")?;
            PlanNode::TitleRiff {
                role: *role,
                data: settings.produce(
                    &clock.title_sample(span)?,
                    clock.width as u32,
                    clock.height as u32,
                    fonts,
                    images,
                )?,
            }
        }
        Scene::KanjiSlam {
            role,
            settings,
            span,
        } => {
            let (fonts, images) = clock.facts("kanjiSlam")?;
            PlanNode::KanjiSlam {
                role: *role,
                data: settings.produce(
                    &clock.kanji_sample(span)?,
                    clock.width as u32,
                    clock.height as u32,
                    fonts,
                    images,
                )?,
            }
        }
        Scene::Ember {
            role,
            settings,
            span,
        } => PlanNode::Ember {
            role: *role,
            data: settings.plan(&clock.ember_sample(span)?)?,
        },
        _ => return Ok(None),
    }))
}

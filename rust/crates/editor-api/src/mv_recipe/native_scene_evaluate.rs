//! Native resource scenes share the evaluator's integer clock and traversal.
use super::{Clock, PlanNode, Scene, Span};
use crate::mv_recipe::kanji_slam;
#[path = "night_recipe_dispatch.rs"]
mod night;

impl Clock<'_> {
    fn road_sample(&self, span: &Span) -> Result<super::super::road_recipe::Sample<'_>, String> {
        let sample = self.ember_sample(span)?;
        Ok(super::super::road_recipe::Sample {
            song_ticks: sample.song_ticks,
            shot_start_ticks: sample.shot_start_ticks,
            shot_end_ticks: sample.shot_end_ticks,
            analysis: sample.analysis,
        })
    }
    fn tunnel_sample(&self, span: &Span) -> Result<super::super::tunnel::Sample<'_>, String> {
        let sample = self.ember_sample(span)?;
        Ok(super::super::tunnel::Sample {
            shot_start_ticks: sample.shot_start_ticks,
            shot_end_ticks: sample.shot_end_ticks,
            song_ticks: sample.song_ticks,
            analysis: sample.analysis,
        })
    }
    fn ink_sample(&self, span: &Span) -> Result<crate::mv_recipe::ink::Sample<'_>, String> {
        let sample = self.ember_sample(span)?;
        Ok(crate::mv_recipe::ink::Sample {
            shot_start_ticks: sample.shot_start_ticks,
            shot_end_ticks: sample.shot_end_ticks,
            song_ticks: sample.song_ticks,
            analysis: sample.analysis,
        })
    }
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

pub(super) fn preflight(scene: &Scene, clock: Clock<'_>, id: &str) -> Result<(), String> {
    match scene {
        Scene::Jz { settings, span, .. } => {
            let s = clock.ember_sample(span)?;
            super::super::jz::request(
                settings,
                s.shot_start_ticks,
                [s.shot_start_ticks, s.shot_end_ticks],
                clock.resources,
            )?;
        }
        Scene::Rewind { span, .. }
        | Scene::IllustNative { span, .. }
        | Scene::Burst { span, .. } => {
            let sample = clock.ember_sample(span)?;
            super::super::heart_recipe::runtime_ready(
                sample.analysis,
                sample.shot_start_ticks,
                sample.shot_end_ticks,
            )?;
        }
        Scene::Night { settings, .. } => night::preflight(settings, clock, id)?,
        Scene::Memories { span, .. } => {
            let sample = clock.ember_sample(span)?;
            super::super::heart_recipe::runtime_ready(
                sample.analysis,
                sample.shot_start_ticks,
                sample.shot_end_ticks,
            )?;
        }
        Scene::HeartShatter { span, .. }
        | Scene::HeartShatterBurn { span, .. }
        | Scene::HeartGather { span, .. }
        | Scene::SunBloom { span, .. }
        | Scene::SkyShatter { span, .. } => {
            let sample = clock.ember_sample(span)?;
            super::super::heart_recipe::runtime_ready(
                sample.analysis,
                sample.shot_start_ticks,
                sample.shot_end_ticks,
            )?;
        }
        Scene::Road { settings, span, .. } => {
            let start = u64::from(span.start_frame);
            let end = start + u64::from(span.duration_frames);
            let resource_clock = clock.remap(clock.frame.clamp(start, end));
            settings.runtime_ready(
                &resource_clock.road_sample(span)?,
                clock.images,
                clock.resources,
            )?;
        }
        Scene::Tunnel { .. } => {
            clock
                .tunnel_fonts
                .ok_or("Tunnel requires byte-admitted measured fonts")?
                .metrics(id)?;
        }
        Scene::Flame { settings, span, .. } => {
            let images = clock.images.ok_or("flame requires decoded image facts")?;
            let start = u64::from(span.start_frame);
            let end = start + u64::from(span.duration_frames);
            let resource_clock = clock.remap(clock.frame.clamp(start, end));
            settings.runtime_ready(&resource_clock.flame_sample(span)?, images, clock.resources)?;
        }
        Scene::Fall { settings, span, .. } => {
            let images = clock.images.ok_or("fall requires decoded image facts")?;
            let start = u64::from(span.start_frame);
            let end = start + u64::from(span.duration_frames);
            let resource_clock = clock.remap(clock.frame.clamp(start, end));
            settings.runtime_ready(&resource_clock.fall_sample(span)?, images)?;
        }
        Scene::Ink { settings, span, .. } => {
            let images = clock.images.ok_or("ink requires decoded image facts")?;
            let start = u64::from(span.start_frame);
            let end = start + u64::from(span.duration_frames);
            let resource_clock = clock.remap(clock.frame.clamp(start, end));
            settings.runtime_ready(&resource_clock.ink_sample(span)?, images)?;
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
        | Scene::Layers { .. }
        | Scene::Panels { .. }
        | Scene::Transition { .. } => return Ok(false),
        _ => {}
    }
    Ok(true)
}

pub(super) fn resolve(
    scene: &Scene,
    clock: Clock<'_>,
    id: &str,
) -> Result<Option<PlanNode>, String> {
    Ok(Some(match scene {
        Scene::Jz {
            role,
            settings,
            span,
        } => {
            let s = clock.ember_sample(span)?;
            PlanNode::JzOwnerRequest {
                role: *role,
                node_id: id.to_owned(),
                request: super::super::jz::request(
                    settings,
                    s.song_ticks,
                    [s.shot_start_ticks, s.shot_end_ticks],
                    clock.resources,
                )?,
            }
        }
        Scene::IllustNative {
            settings,
            bpm,
            span,
        } => PlanNode::IllustNative {
            data: super::super::illust_native::plan(
                settings,
                *bpm,
                &clock.ember_sample(span)?,
                clock.resources,
            )?,
        },
        Scene::Burst {
            role,
            settings,
            bpm,
            span,
        } => PlanNode::Burst {
            role: *role,
            data: super::super::burst::plan(
                settings,
                *bpm,
                &clock.ember_sample(span)?,
                clock.resources,
            )?,
        },
        Scene::Night {
            role,
            settings,
            span,
        } => {
            let traversal = clock
                .night_traversal
                .ok_or("Night requires evaluator-issued traversal")?;
            PlanNode::NightOwnerRequest {
                role: *role,
                node_id: id.to_owned(),
                request: night::request(settings, span, clock, id, &mut traversal.borrow_mut())?,
            }
        }
        Scene::Memories { role, span, .. } => PlanNode::MemoriesOwnerRequest {
            role: *role,
            node_id: id.to_owned(),
            request: super::super::memories_recipe::request(
                scene,
                &clock.ember_sample(span)?,
                clock.resources,
            )?,
        },
        Scene::HeartShatter { role, span, .. }
        | Scene::HeartShatterBurn { role, span, .. }
        | Scene::HeartGather { role, span, .. }
        | Scene::SunBloom { role, span, .. }
        | Scene::SkyShatter { role, span, .. } => PlanNode::HeartOwnerRequest {
            role: *role,
            node_id: id.to_owned(),
            request: super::super::heart_recipe::request(
                scene,
                &clock.ember_sample(span)?,
                clock.resources,
            )?,
        },
        Scene::Road {
            role,
            settings,
            span,
        } => {
            let (data, native_post) = settings.produce(
                &clock.road_sample(span)?,
                clock.width as u32,
                clock.height as u32,
                clock.images,
                clock.resources,
            )?;
            PlanNode::Road {
                role: *role,
                data,
                native_post,
            }
        }
        Scene::Tunnel {
            role,
            settings,
            span,
        } => {
            let sample = clock.tunnel_sample(span)?;
            PlanNode::Tunnel {
                role: *role,
                data: settings.produce(
                    &sample,
                    clock.width as u32,
                    clock.height as u32,
                    clock
                        .tunnel_fonts
                        .ok_or("Tunnel requires byte-admitted measured fonts")?
                        .metrics(id)?,
                )?,
                native_post: settings.native_post(
                    &sample,
                    clock.width as u32,
                    clock.height as u32,
                )?,
            }
        }
        Scene::Flame {
            role,
            settings,
            span,
        } => PlanNode::Flame {
            role: *role,
            data: settings.produce(
                &clock.flame_sample(span)?,
                clock.width as u32,
                clock.height as u32,
                clock.images.ok_or("flame requires decoded image facts")?,
                clock.resources,
            )?,
        },
        Scene::Fall {
            role,
            settings,
            span,
        } => PlanNode::Fall {
            role: *role,
            data: settings.produce(
                &clock.fall_sample(span)?,
                clock.width as u32,
                clock.height as u32,
                clock.images.ok_or("fall requires decoded image facts")?,
            )?,
        },
        Scene::Ink {
            role,
            settings,
            span,
        } => PlanNode::Ink {
            role: *role,
            data: settings.produce(
                &clock.ink_sample(span)?,
                clock.width as u32,
                clock.height as u32,
                clock.images.ok_or("ink requires decoded image facts")?,
            )?,
        },
        Scene::Thread {
            role,
            settings,
            span,
        } => PlanNode::Thread {
            role: *role,
            data: settings.produce(
                &clock.thread_sample(span)?,
                clock.width as u32,
                clock.height as u32,
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

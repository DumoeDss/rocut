use super::model::*;
use std::cell::RefCell;

#[path = "evaluate_clock.rs"]
mod clock;
#[path = "native_scene_evaluate.rs"]
mod native_scene;
pub(super) use clock::Clock;

pub(super) fn lerp(a: f64, b: f64, p: f64) -> f64 {
    a + (b - a) * p
}
fn ease(p: f64, e: Ease) -> f64 {
    let p = p.clamp(0.0, 1.0);
    match e {
        Ease::Linear => p,
        Ease::InOutSine => (1.0 - (p * std::f64::consts::PI).cos()) * 0.5,
        Ease::InOutCubic => {
            if p < 0.5 {
                4.0 * p * p * p
            } else {
                1.0 - (-2.0 * p + 2.0).powi(3) * 0.5
            }
        }
        Ease::InQuad => p * p,
        Ease::OutQuad => 1.0 - (1.0 - p).powi(2),
        Ease::InExpo => super::transitions::in_expo(p),
        Ease::OutExpo => super::transitions::out_expo(p),
        Ease::InOutExpo => {
            if p <= 0.0 {
                0.0
            } else if p >= 1.0 {
                1.0
            } else if p < 0.5 {
                2.0f64.powf(20.0 * p - 10.0) / 2.0
            } else {
                (2.0 - 2.0f64.powf(-20.0 * p + 10.0)) / 2.0
            }
        }
    }
}
pub(super) fn progress(frame: f64, span: &Span, e: Ease) -> f64 {
    ease(
        (frame - f64::from(span.start_frame)) / f64::from(span.duration_frames),
        e,
    )
}


impl Recipe {
    /// Call only after validation. References explicitly replace the child
    /// clock. The outer post clock and native song/audio timeline stay unchanged.
    pub fn resolve(
        &self,
        index: u64,
        step: u64,
        seed: u32,
        width: u32,
        height: u32,
        audio: Option<&crate::mv_audio::Data>,
        resources: &[crate::programmatic_resources::Resource],
        sequence_source_ticks: u64,
        sequences: Option<&crate::image_sequence::Context<'_>>,
    ) -> Result<Plan, String> {
        self.resolve_with_fonts(index, step, seed, width, height, audio, resources,
            sequence_source_ticks, sequences, None)
    }
    pub fn resolve_with_fonts(
        &self,
        index: u64,
        step: u64,
        seed: u32,
        width: u32,
        height: u32,
        audio: Option<&crate::mv_audio::Data>,
        resources: &[crate::programmatic_resources::Resource],
        sequence_source_ticks: u64,
        sequences: Option<&crate::image_sequence::Context<'_>>,
        fonts: Option<&crate::mv_font_metrics::Context>,
    ) -> Result<Plan, String> {
        self.resolve_with_resources(index, step, seed, width, height, audio, resources,
            sequence_source_ticks, sequences, fonts, None)
    }
    pub fn resolve_with_resources(
        &self,
        index: u64,
        step: u64,
        seed: u32,
        width: u32,
        height: u32,
        audio: Option<&crate::mv_audio::Data>,
        resources: &[crate::programmatic_resources::Resource],
        sequence_source_ticks: u64,
        sequences: Option<&crate::image_sequence::Context<'_>>,
        fonts: Option<&crate::mv_font_metrics::Context>,
        images: Option<&crate::mv_image_dimensions::Context>,
    ) -> Result<Plan, String> {
        let clock = Clock::new(self, index, step, seed, width, height, audio, resources,
            sequence_source_ticks, sequences, fonts, images, None)?;
        // Resource/audio facts belong to the complete authored source, not only
        // a currently visible branch. Black/stopped frames must not hide errors.
        for node in &self.nodes {
            native_scene::preflight(&node.scene, clock)?;
        }
        Ok(Plan {
            version: 1,
            song_seconds: clock.song_seconds(),
            // Canonical compositing order, independent of selection-list order.
            output_roles: [
                Role::Background,
                Role::Subject,
                Role::Graphics,
                Role::Foreground,
            ]
            .into_iter()
            .filter(|r| self.output_roles.contains(r))
            .collect(),
            root: self.node(&self.root, clock)?,
            post: self
                .post
                .iter()
                .map(|p| {
                    Ok(PostPlan {
                        stage: p.stage,
                        roles: p.roles.clone(),
                        effects: p
                            .effects
                            .iter()
                            .enumerate()
                            .map(|(i, e)| {
                                let animated = super::post_automation::effect(
                                    &p.automation,
                                    i,
                                    e,
                                    clock.frame,
                                );
                                let effect = super::audio::effect(
                                    &p.audio,
                                    i,
                                    &animated,
                                    audio,
                                    clock.root_song_seconds,
                                )?
                                .lower();
                                let light_leak = super::light_leak::resolve(
                                    &effect,
                                    clock.root_song_seconds,
                                    seed,
                                    clock.width,
                                    clock.height,
                                );
                                Ok(EffectPlan {
                                    seed: e.sampling_rate().map_or(seed, |fps| {
                                        seed.wrapping_add(clock.sample(fps) as u32)
                                    }),
                                    effect,
                                    light_leak,
                                })
                            })
                            .collect::<Result<Vec<_>, String>>()?,
                    })
                })
                .collect::<Result<Vec<_>, String>>()?,
        })
    }
    pub fn sampled_font_metric_requests(
        &self, index: u64, step: u64, seed: u32, width: u32, height: u32,
        audio: Option<&crate::mv_audio::Data>,
        resources: &[crate::programmatic_resources::Resource],
    ) -> Result<Vec<crate::mv_font_metrics::Request>, String> {
        let requests = RefCell::new(self.font_metric_requests(resources)?);
        let clock = Clock::new(self, index, step, seed, width, height, audio, resources,
            index.checked_mul(step).ok_or("MV source time overflow")?, None, None, None, Some(&requests))?;
        // Reuse the exact structural graph, including reference/sequence maps,
        // transition endpoints and hidden/collapsed panels. No parallel clock.
        self.node(&self.root, clock)?;
        Ok(requests.into_inner())
    }
    fn node(&self, id: &str, clock: Clock) -> Result<PlanNode, String> {
        let scene = &self
            .nodes
            .iter()
            .find(|n| n.id == id)
            .expect("validated MV node")
            .scene;
        if native_scene::collect_font_requests(scene, clock)? {
            return Ok(PlanNode::Empty);
        }
        if let Some(native) = native_scene::resolve(scene, clock)? {
            return Ok(native);
        }
        if let Some(generator) = super::generator_evaluate::resolve(scene, clock)? {
            return Ok(generator);
        }
        Ok(match scene {
            Scene::TitleRiff { .. } | Scene::KanjiSlam { .. } | Scene::Ember { .. } => unreachable!("native scene already resolved"),
            Scene::Converge { role, settings, span } => PlanNode::Converge {
                role: *role,
                data: settings.plan(&super::converge::Sample {
                    shot_start_ticks: u64::from(span.start_frame).checked_mul(clock.step)
                        .and_then(|v| v.checked_add(clock.song_start_ticks)).ok_or("Converge shot start overflow")?,
                    song_ticks: clock.song_start_ticks.checked_add(clock.source_ticks).ok_or("Converge song time overflow")?,
                    width: clock.width, height: clock.height, seed: clock.seed, analysis: clock.audio,
                })?,
            },
            Scene::TypeCard { role, settings, span } => PlanNode::TypeCard {
                role: *role,
                data: settings.plan(&super::type_card::Sample {
                    elapsed_ticks: clock.elapsed(span)?,
                    duration_ticks: u64::from(span.duration_frames).checked_mul(clock.step).ok_or("TypeCard duration overflow")?,
                    shot_start_ticks: u64::from(span.start_frame).checked_mul(clock.step)
                        .and_then(|v| v.checked_add(clock.song_start_ticks)).ok_or("TypeCard shot start overflow")?,
                    song_ticks: clock.song_start_ticks.checked_add(clock.source_ticks).ok_or("TypeCard song time overflow")?,
                    width: clock.width, height: clock.height, seed: clock.seed, fonts: clock.fonts, analysis: clock.audio,
                })?,
            },
            Scene::Afterimage { role, settings, span } => PlanNode::Afterimage {
                role: *role,
                data: settings.plan(clock.elapsed(span)? as f64 / 120_000.0,
                    u64::from(span.duration_frames).checked_mul(clock.step).ok_or("MV afterimage duration overflow")? as f64 / 120_000.0,
                    clock.sample(24), clock.seed, clock.width, clock.height),
            },
            Scene::ImageSequence { sequence, origin_source_ticks, rate, role, view } => PlanNode::ImageSequence {
                image_key: clock.sequences.ok_or("Missing image sequence manifest context")?
                    .sample(sequence, clock.sequence_source_ticks, *origin_source_ticks, *rate)?,
                role: *role,
                view: *view,
            },
            Scene::Cloth { .. }
            | Scene::Shatter { .. }
            | Scene::Grid { .. }
            | Scene::HexFloat { .. }
            | Scene::AsciiSweep { .. }
            | Scene::ParticleScroll { .. }
            | Scene::GlyphRain { .. }
            | Scene::ParticleReveal { .. } => unreachable!("generator already resolved"),
            Scene::Ref { input, time_map } => {
                let sampled_frame = super::reference::sample(time_map, clock.frame);
                PlanNode::Ref {
                    input: Box::new(self.node(input, clock.remap(sampled_frame))?),
                    sampled_frame,
                }
            }
            Scene::Sequence { items } => {
                match items.iter().find(|s| {
                    clock.frame >= u64::from(s.span.start_frame)
                        && clock.frame < u64::from(s.span.start_frame + s.span.duration_frames)
                }) {
                    Some(s) => {
                        let sampled_frame = super::reference::sample(&s.time_map, clock.frame);
                        PlanNode::Ref {
                            input: Box::new(self.node(&s.input, clock.remap(sampled_frame))?),
                            sampled_frame,
                        }
                    }
                    None => PlanNode::Empty,
                }
            }
            Scene::Panels {
                panels,
                collapse,
                border,
            } => {
                let grow = collapse
                    .as_ref()
                    .map_or(0.0, |c| progress(clock.frame as f64, &c.span, c.easing));
                let hero = collapse.as_ref().map(|c| c.hero);
                let order = (0..panels.len())
                    .filter(|i| Some(*i) != hero)
                    .chain(hero)
                    .collect::<Vec<_>>();
                PlanNode::Panels {
                    panels: order
                        .into_iter()
                        .map(
                            |i| -> Result<Option<super::panel_model::PanelPlan>, String> {
                                if grow >= 1.0 && Some(i) != hero {
                                    return Ok(None);
                                }
                                let Some((polygon, transform)) = super::panels::geometry(
                                    &panels[i],
                                    clock.frame,
                                    if Some(i) == hero { grow } else { 0.0 },
                                    clock.width,
                                    clock.height,
                                ) else {
                                    return Ok(None);
                                };
                                Ok(Some(super::panel_model::PanelPlan {
                                    input: Box::new(self.node(&panels[i].input, clock)?),
                                    polygon,
                                    transform,
                                    border: if grow >= 1.0 && Some(i) == hero {
                                        None
                                    } else {
                                        border.clone()
                                    },
                                }))
                            },
                        )
                        .collect::<Result<Vec<_>, String>>()?
                        .into_iter()
                        .flatten()
                        .collect(),
                }
            }
            Scene::Solid { role, color } => PlanNode::Solid {
                role: *role,
                color: *color,
            },
            Scene::Illust {
                motion,
                easing,
                background,
                sprites,
            } => {
                let p = progress(clock.frame as f64, motion, *easing);
                PlanNode::Illust {
                    background: background
                        .as_ref()
                        .map(|b| -> Result<BackgroundPlan, String> {
                            Ok(BackgroundPlan {
                                image: b.image.clone(),
                                camera: super::audio::camera(
                                    &b.audio,
                                    Camera {
                                        x: lerp(b.from.x, b.to.x, p),
                                        y: lerp(b.from.y, b.to.y, p),
                                        zoom: lerp(b.from.zoom, b.to.zoom, p),
                                    },
                                    clock.audio,
                                    clock.root_song_seconds,
                                    clock.song_seconds(),
                                )?,
                            })
                        })
                        .transpose()?,
                    sprites: sprites
                        .iter()
                        .map(|s| {
                            let (t, drawing_frame) = clock.drawing(s.drawing_fps);
                            s.resolve(
                                t,
                                drawing_frame,
                                motion,
                                *easing,
                                clock.audio,
                                clock.root_song_seconds,
                            )
                        })
                        .collect::<Result<Vec<_>, String>>()?,
                }
            }
            Scene::Transition {
                from,
                to,
                span,
                easing,
                style,
            } => {
                if matches!(style, Transition::Cut) {
                    return self.node(
                        if clock.frame < u64::from(span.start_frame) {
                            from
                        } else {
                            to
                        },
                        clock,
                    );
                }
                let p = progress(clock.frame as f64, span, *easing);
                // Do not retain/capture an inactive side at exact endpoints.
                if p <= 0.0 {
                    return self.node(from, clock);
                }
                if p >= 1.0 {
                    return self.node(to, clock);
                }
                PlanNode::Transition {
                    from: Box::new(self.node(from, clock)?),
                    to: Box::new(self.node(to, clock)?),
                    progress: p,
                    style: style.clone(),
                    commands: style.plan(p, clock.width, clock.height, clock.seed),
                }
            }
        })
    }
}

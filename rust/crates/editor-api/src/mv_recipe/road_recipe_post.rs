use super::{Road, Sample, road};
use serde::Serialize;
use serde_json::json;
const PROFILE: &str = "road-original-gl-v1";
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativePost {
    pub plan: crate::ReferencePostPlan,
    pub profile: &'static str,
    pub required: bool,
    pub mode: road::model::Mode,
    pub song_ticks: u64,
    pub shot_start_ticks: u64,
    pub shot_end_ticks: u64,
    pub bloom: f64,
    #[serde(rename = "beatCA")]
    pub beat_ca: u32,
    pub beats: Vec<u64>,
    pub transition: Option<Black>,
    pub dawn: Option<Dawn>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Black {
    pub kind: &'static str,
    pub duration_seconds: f64,
}
#[derive(Serialize)]
pub struct Dawn {
    pub mix: f64,
    pub stops: [(f64, &'static str); 6],
}
pub(super) fn resolve(a: &Road, s: &Sample<'_>, beats: &[u64]) -> Result<NativePost, String> {
    let tear = a.mode == road::model::Mode::Tear;
    // core/main.js uses the most recent whole-song beat and decay 9 for post;
    // Road's internal tile pulse uses 6.5 and is intentionally not reused.
    let before = beats.partition_point(|beat| *beat <= s.song_ticks);
    let pulse = if before == 0 {
        0.0
    } else {
        (-9.0 * (s.song_ticks - beats[before - 1]) as f64 / 120000.0).exp()
    };
    let mut plan = crate::build_reference_post_plan(
        1920,
        1080,
        i64::try_from(s.song_ticks).map_err(|_| "Road post clock overflow")?,
        120000,
        &json!({"bloom":0.55,"ca":if tear {0.0} else {2.0*pulse},
            "lutA":0,"lutMix":if tear {0.08} else {0.0}}),
    )?;
    plan.profile = PROFILE;
    Ok(NativePost {
        plan,
        profile: PROFILE,
        required: true,
        mode: a.mode.clone(),
        song_ticks: s.song_ticks,
        shot_start_ticks: s.shot_start_ticks,
        shot_end_ticks: s.shot_end_ticks,
        bloom: 0.55,
        beat_ca: if tear { 0 } else { 2 },
        beats: beats.to_vec(),
        // Original timeline trans is an INTO-shot structural black transition;
        // the post host must not bake it into the Road leaf as an internal fade.
        transition: tear.then_some(Black {
            kind: "black",
            duration_seconds: 0.3,
        }),
        dawn: tear.then_some(Dawn {
            mix: 0.08,
            stops: [
                (0.0, "#120d24"),
                (0.3, "#3a2d63"),
                (0.55, "#9a6aa0"),
                (0.75, "#f3a6a0"),
                (0.9, "#ffd9b0"),
                (1.0, "#fffaf0"),
            ],
        }),
    })
}

#[cfg(test)]
#[path = "road_recipe_post_tests.rs"]
mod tests;

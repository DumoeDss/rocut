use super::{Sample, math, model::Beats};

pub(super) struct Phase {
    pub layout: usize,
    pub since: f64,
    pub white: f64,
}
pub(super) fn phase(beats: &Beats, s: &Sample<'_>) -> Result<Phase, String> {
    let values = match beats {
        Beats::Analysis {} => {
            &s.analysis
                .ok_or("TypeCard flicker requires reviewed audio analysis")?
                .beats
        }
        Beats::Manual { song_ticks } => song_ticks,
    };
    let start = s.shot_start_ticks;
    let end = start
        .checked_add(s.duration_ticks)
        .ok_or("TypeCard shot end overflow")?;
    let mut selected: Vec<u64> = values
        .iter()
        .copied()
        .filter(|v| *v >= start.saturating_sub(5400) && *v < end.saturating_sub(5400))
        .collect();
    if selected.is_empty() || selected[0] > start.saturating_add(5400) {
        selected.insert(0, start);
    } else {
        selected[0] = selected[0].min(start);
    }
    if selected.len() > 1024 {
        return Err("TypeCard shot exceeds 1024 selected beats".into());
    }
    let t = start
        .checked_add(s.elapsed_ticks)
        .ok_or("TypeCard sample overflow")?;
    let k = selected.partition_point(|v| *v <= t).saturating_sub(1);
    let last = *selected.last().expect("shot start supplies one beat");
    let white =
        math::clamp(t.saturating_sub(last) as f64 / ((end - last) as f64).max(24_000.0)).powf(2.1);
    Ok(Phase {
        layout: (k as isize - (selected.len() as isize - 4)).clamp(0, 3) as usize,
        since: t.saturating_sub(selected[k]) as f64 / 120_000.0,
        white,
    })
}

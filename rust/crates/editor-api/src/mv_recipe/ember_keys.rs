use super::{
    Sample,
    clock::{self, seconds},
    math::lerp,
    model::{Collapse, Easing, Keys},
};

pub(super) struct Key {
    pub time: f64,
    pub factor: f64,
    pub easing: Easing,
    pub hit: bool,
}
pub(super) fn resolve(a: &Collapse, s: &Sample<'_>) -> Result<Vec<Key>, String> {
    let result = match &a.keys {
        Keys::Manual { values } => values
            .iter()
            .map(|k| Key {
                time: seconds(k.song_ticks),
                factor: k.factor,
                easing: k.easing,
                hit: k.hit,
            })
            .collect(),
        Keys::Analysis { beats } => {
            let data = s
                .analysis
                .ok_or("Automatic Ember collapse keys require reviewed audio")?;
            let onsets=data.strong_onsets.as_ref().ok_or("Automatic Ember collapse requires measured reference strongOnsets; raw candidates are not substitutes")?;
            let all = clock::beats(beats, s)?;
            let start = seconds(s.shot_start_ticks);
            let end = seconds(a.end_ticks);
            let b = clock::from(&all, start, 10);
            let mut hits: Vec<_> = onsets
                .events
                .iter()
                .filter(|event| {
                    seconds(event.at_ticks) > b[4] + 0.1
                        && seconds(event.at_ticks) < end - 0.3
                        && event.strength >= 0.5
                })
                .take(3)
                .map(|event| seconds(event.at_ticks))
                .collect();
            while hits.len() < 3 {
                hits.push(lerp(b[4], b[7], (hits.len() + 1) as f64 / 4.0));
            }
            // Source order is meaningful: fallback may follow a later measured hit.
            [
                (start, 1.0, Easing::Out, false),
                (b[3], 0.86, Easing::Soft, false),
                (b[4] - 0.1, 0.9, Easing::Soft, false),
                (b[4], 0.66, Easing::Out, true),
                (hits[0], 0.5, Easing::Out, true),
                (hits[1], 0.35, Easing::Out, true),
                (hits[2], 0.25, Easing::Out, true),
                (b[7], 0.15, Easing::Soft, true),
                (end - 0.17, 0.003, Easing::In, false),
            ]
            .into_iter()
            .map(|(time, factor, easing, hit)| Key {
                time,
                factor,
                easing,
                hit,
            })
            .collect()
        }
    };
    let result: Vec<Key> = result;
    if result.len() < 3
        || result.windows(2).any(|p| p[0].time == p[1].time)
        || result[2].time >= seconds(a.end_ticks)
    {
        return Err(
            "Ember collapse keys require distinct adjacent cue times and a third cue before end"
                .into(),
        );
    }
    Ok(result)
}

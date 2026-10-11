use serde::{Deserialize, Serialize};
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct View {
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
    #[serde(default)]
    pub zoom: Option<f64>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(untagged)]
pub enum PhotoChar {
    Enabled(bool),
    Resource(String),
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Photo {
    pub bg: String,
    #[serde(default)]
    pub caption: String,
    #[serde(default)]
    pub date: Option<String>,
    #[serde(default)]
    pub view: Option<View>,
    #[serde(default)]
    pub char: Option<PhotoChar>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Args {
    pub photos: Vec<Photo>,
    #[serde(default)]
    pub char: Option<String>,
    #[serde(default)]
    pub char_in: Option<i32>,
    #[serde(default)]
    pub order: Option<Vec<u32>>,
    #[serde(default)]
    pub drop_beats: Option<Vec<u32>>,
    #[serde(default)]
    pub burn_beats: Option<Vec<f64>>,
    #[serde(default)]
    pub push_at: Option<f64>,
    #[serde(default)]
    pub end_zoom: Option<f64>,
    #[serde(default)]
    pub seed: Option<u32>,
    pub caption_font: String,
    pub date_font: String,
}
pub const DATES: [&str; 6] = ["4.17", "7.30", "9.02", "10.21", "12.24", "3.08"];
pub struct Selection {
    pub order: Vec<usize>,
    pub hero: usize,
    pub char_in: Option<usize>,
    pub character: Option<String>,
}
pub fn select(a: &Args) -> Result<Selection, String> {
    let n = a.photos.len();
    if n == 0 || n > 16 {
        return Err("Memories requires1..16 explicit photos".into());
    }
    // The same closed author policy applies before source loading and during
    // owner preparation; invalid schedules must not wait for the first frame.
    if a.caption_font.is_empty()
        || a.date_font.is_empty()
        || a.photos.iter().any(|p| {
            p.bg.is_empty()
                || p.view.as_ref().is_some_and(|v| {
                    [v.x, v.y, v.zoom.unwrap_or(1.0)]
                        .iter()
                        .any(|v| !v.is_finite() || v.abs() > 16.0)
                        || v.zoom.unwrap_or(1.0) < 0.0
                })
        })
        || a.drop_beats
            .as_ref()
            .is_some_and(|v| v.is_empty() || v.len() > 16 || v.iter().any(|v| *v > 21600))
        || a.burn_beats.as_ref().is_some_and(|v| {
            v.is_empty()
                || v.len() > 16
                || v.iter()
                    .any(|v| !v.is_finite() || !(0.0..=21600.0).contains(v))
        })
        || a.push_at
            .is_some_and(|v| !v.is_finite() || v.abs() > 21600.0)
        || a.end_zoom
            .is_some_and(|v| !v.is_finite() || !(0.01..=16.0).contains(&v))
    {
        return Err("Memories authored resources, crop or schedule exceed bounds".into());
    }
    let char_in = match a.char_in {
        Some(i) if i < 0 => None,
        Some(i) if (i as usize) < n => Some(i as usize),
        Some(_) => return Err("Memories character photo index exceeds bounds".into()),
        None => {
            let chosen = a.photos.iter().position(|p| match &p.char {
                Some(PhotoChar::Enabled(true)) => true,
                Some(PhotoChar::Resource(id)) => !id.is_empty(),
                _ => false,
            });
            chosen.or_else(|| {
                a.char.as_ref().map(|_| {
                    a.photos
                        .iter()
                        .position(|p| p.bg.contains("embankment"))
                        .unwrap_or(n - 1)
                })
            })
        }
    };
    let character = char_in.and_then(|i| match &a.photos[i].char {
        Some(PhotoChar::Resource(id)) => Some(id.clone()),
        _ => a.char.clone(),
    });
    let hero = char_in.unwrap_or(n - 1);
    let order = match &a.order {
        Some(ids) => {
            if ids.len() != n {
                return Err("Memories order must name every photo exactly once".into());
            }
            let mut seen = vec![false; n];
            for i in ids {
                if *i as usize >= n || seen[*i as usize] {
                    return Err("Memories order is not a photo permutation".into());
                }
                seen[*i as usize] = true;
            }
            ids.iter().map(|i| *i as usize).collect()
        }
        None => (0..n)
            .filter(|i| *i != hero)
            .chain(std::iter::once(hero))
            .collect(),
    };
    if a.photos.iter().any(|p| {
        p.caption.chars().count() > 128 || p.date.as_ref().is_some_and(|d| d.chars().count() > 32)
    }) {
        return Err("Memories caption or date exceeds limits".into());
    }
    Ok(Selection {
        order,
        hero,
        char_in,
        character,
    })
}

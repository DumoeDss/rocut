//! Pure closed layout of original core/main.js buildLutAtlas. Palette order is input.
use std::collections::{BTreeMap, BTreeSet};
pub struct Palette {
    pub id: String,
    pub lut: String,
    pub lut_duotone: String,
}
pub enum Row {
    Image {
        path: String,
    },
    Ramp {
        name: &'static str,
        stops: Vec<(f64, &'static str)>,
    },
}
pub struct Layout {
    pub rows: Vec<Row>,
    pub aliases: BTreeMap<String, u8>,
    pub palette_aliases: BTreeMap<String, usize>,
}
pub fn layout(palettes: &[Palette]) -> Result<Layout, String> {
    if palettes.len() > 5 {
        return Err("LUT atlas exceeds original 16 rows".into());
    }
    let mut rows = Vec::new();
    let mut aliases = BTreeMap::new();
    let mut palette_aliases = BTreeMap::new();
    let mut ids = BTreeSet::new();
    let mut paths = BTreeSet::new();
    for (index, p) in palettes.iter().enumerate() {
        if p.id.is_empty()
            || p.id.len() > 128
            || !p
                .id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
            || !ids.insert(&p.id)
        {
            return Err("LUT atlas invalid/duplicate palette ID".into());
        }
        let prefix = p.id.split('_').next().unwrap();
        if prefix.is_empty() || palette_aliases.insert(prefix.into(), index).is_some() {
            return Err("LUT atlas duplicate palette prefix".into());
        }
        for (suffix, path) in [("", &p.lut), ("_duo", &p.lut_duotone)] {
            if path.is_empty()
                || path.len() > 512
                || path.chars().any(char::is_control)
                || !paths.insert(path)
            {
                return Err("LUT atlas missing/duplicate image path".into());
            }
            let row = rows.len() as u8;
            for alias in [format!("{}{suffix}", p.id), format!("{prefix}{suffix}")] {
                if let Some(previous) = aliases.insert(alias, row) {
                    if previous != row {
                        return Err("LUT atlas duplicate row alias".into());
                    }
                }
            }
            rows.push(Row::Image { path: path.clone() });
        }
    }
    let ramps: [(&str, Vec<(f64, &str)>); 5] = [
        (
            "night",
            vec![
                (0.0, "#04060d"),
                (0.3, "#0d1a33"),
                (0.55, "#23407a"),
                (0.75, "#7aa6d6"),
                (0.9, "#e8c38a"),
                (1.0, "#fff4dc"),
            ],
        ),
        (
            "ember",
            vec![
                (0.0, "#07040a"),
                (0.35, "#2a0c14"),
                (0.6, "#8e1f22"),
                (0.8, "#f06a2a"),
                (1.0, "#ffe2a8"),
            ],
        ),
        (
            "dawn",
            vec![
                (0.0, "#120d24"),
                (0.3, "#3a2d63"),
                (0.55, "#9a6aa0"),
                (0.75, "#f3a6a0"),
                (0.9, "#ffd9b0"),
                (1.0, "#fffaf0"),
            ],
        ),
        ("mono", vec![(0.0, "#0b0a0d"), (1.0, "#f4efe6")]),
        (
            "day",
            vec![
                (0.0, "#0e2a47"),
                (0.5, "#2c8fc4"),
                (0.8, "#bfe8fa"),
                (1.0, "#ffffff"),
            ],
        ),
    ];
    for (name, stops) in ramps {
        if aliases.insert(name.into(), rows.len() as u8).is_some() {
            return Err("LUT atlas palette collides with original ramp alias".into());
        }
        rows.push(Row::Ramp { name, stops });
    }
    Ok(Layout {
        rows,
        aliases,
        palette_aliases,
    })
}

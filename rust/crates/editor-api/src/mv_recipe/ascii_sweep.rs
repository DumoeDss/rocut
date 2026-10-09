//! A stateless, cell-based transition between two authored texts.
use super::catalog::{GENERATOR_PRIMITIVES, MAX_GLYPHS, NumberRule, OPACITY};
use super::model::Color;
use super::transitions::random;
use super::validate::color;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

const MAX_COLUMNS: usize = 128;
const MAX_ROWS: usize = 32;
const MAX_TEXT_SCALARS: usize = MAX_COLUMNS * MAX_ROWS + MAX_ROWS - 1;
const MAX_TEXT_BYTES: usize = MAX_TEXT_SCALARS * 4;
const FONT_SIZE: NumberRule = NumberRule {
    min: 4.0,
    max: 256.0,
    integer: false,
    suggested: 20.0,
};
const BAND_WIDTH: NumberRule = NumberRule {
    min: 0.01,
    max: 1.0,
    integer: false,
    suggested: 0.2,
};
const RECT_POSITION: NumberRule = NumberRule {
    min: 0.0,
    max: 1.0,
    integer: false,
    suggested: 0.05,
};
const RECT_EXTENT: NumberRule = NumberRule {
    min: 0.001,
    max: 1.0,
    integer: false,
    suggested: 0.9,
};
const CELL_ADVANCE: f64 = 0.6;
const LINE_ADVANCE: f64 = 1.2;

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SweepDirection {
    LeftToRight,
    RightToLeft,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AsciiSweep {
    pub font: String,
    pub text_a: String,
    pub text_b: String,
    pub glyphs: String,
    pub rect: [f64; 4],
    pub font_size: f64,
    pub band_width: f64,
    pub color: Color,
    pub active_color: Color,
    pub opacity: f64,
    pub direction: SweepDirection,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AsciiSweepPlan {
    pub font: String,
    pub font_size: f64,
    pub cell_width: f64,
    pub line_height: f64,
    pub color: Color,
    pub active_color: Color,
    pub glyphs: Vec<SweepGlyph>,
}

#[derive(Serialize)]
pub struct SweepGlyph {
    pub text: String,
    pub x: f64,
    pub y: f64,
    pub opacity: f64,
    pub active: bool,
}

fn text_shape(text: &str) -> Option<(usize, usize)> {
    if text.is_empty() || text.len() > MAX_TEXT_BYTES {
        return None;
    }
    let (mut columns, mut rows, mut scalars) = (0, 0, 0);
    for line in text.split('\n') {
        rows += 1;
        if rows > MAX_ROWS || line.chars().any(char::is_control) {
            return None;
        }
        let count = line.chars().count();
        if count > MAX_COLUMNS {
            return None;
        }
        columns = columns.max(count);
        scalars += count + usize::from(rows > 1);
    }
    (scalars <= MAX_TEXT_SCALARS).then_some((columns, rows))
}

impl AsciiSweep {
    fn shape(&self) -> Option<(usize, usize)> {
        let a = text_shape(&self.text_a)?;
        let b = text_shape(&self.text_b)?;
        let shape = (a.0.max(b.0), a.1.max(b.1));
        (shape.0 > 0).then_some(shape)
    }

    pub fn valid(&self) -> bool {
        !self.font.is_empty()
            && self.font.len() <= 240
            && self.work() <= GENERATOR_PRIMITIVES
            && self.glyphs.len() <= MAX_GLYPHS * 4
            && (1..=MAX_GLYPHS).contains(&self.glyphs.chars().count())
            && self.glyphs.chars().all(|c| !c.is_control())
            && self.rect[..2].iter().all(|v| RECT_POSITION.valid(*v))
            && self.rect[2..].iter().all(|v| RECT_EXTENT.valid(*v))
            && self.rect[0] + self.rect[2] <= 1.0
            && self.rect[1] + self.rect[3] <= 1.0
            && FONT_SIZE.valid(self.font_size)
            && BAND_WIDTH.valid(self.band_width)
            && color(&self.color)
            && color(&self.active_color)
            && OPACITY.valid(self.opacity)
    }

    pub fn work(&self) -> u32 {
        self.shape()
            .map_or(u32::MAX, |(columns, rows)| (columns * rows) as u32)
    }

    pub fn fits(&self, width: f64, height: f64) -> bool {
        self.shape().is_some_and(|(columns, rows)| {
            width.is_finite()
                && height.is_finite()
                && width > 0.0
                && height > 0.0
                && columns as f64 * self.font_size * CELL_ADVANCE <= self.rect[2] * width
                && rows as f64 * self.font_size * LINE_ADVANCE <= self.rect[3] * height
        })
    }

    pub fn plan(&self, progress: f64, seed: u32, width: f64, height: f64) -> AsciiSweepPlan {
        let (columns, rows) = self.shape().expect("validated ASCII Sweep text");
        let a: Vec<Vec<char>> = self
            .text_a
            .split('\n')
            .map(|s| s.chars().collect())
            .collect();
        let b: Vec<Vec<char>> = self
            .text_b
            .split('\n')
            .map(|s| s.chars().collect())
            .collect();
        let alphabet: Vec<char> = self.glyphs.chars().collect();
        let cell_width = self.font_size * CELL_ADVANCE;
        let line_height = self.font_size * LINE_ADVANCE;
        let front = -self.band_width / 2.0 + progress * (1.0 + self.band_width);
        let phase = (progress * 256.0).floor() as u32;
        let mut glyphs = Vec::with_capacity(columns * rows);
        for row in 0..rows {
            for column in 0..columns {
                let from = a.get(row).and_then(|line| line.get(column)).copied();
                let to = b.get(row).and_then(|line| line.get(column)).copied();
                let u = (column as f64 + 0.5) * cell_width / (self.rect[2] * width);
                let u = match self.direction {
                    SweepDirection::LeftToRight => u,
                    SweepDirection::RightToLeft => 1.0 - u,
                };
                let (text, active) = if progress <= 0.0 {
                    (from, false)
                } else if progress >= 1.0 || u < front - self.band_width / 2.0 {
                    (to, false)
                } else if u > front + self.band_width / 2.0 || (from.is_none() && to.is_none()) {
                    (from, false)
                } else {
                    let key = (row * columns + column) as u32 + phase * 4099;
                    let index = (random(seed ^ 0x6a09_e667, key) * alphabet.len() as f64) as usize;
                    (Some(alphabet[index]), true)
                };
                glyphs.push(SweepGlyph {
                    text: text.map_or_else(String::new, |c| c.to_string()),
                    x: self.rect[0] * width + (column as f64 + 0.5) * cell_width,
                    y: self.rect[1] * height + (row as f64 + 0.5) * line_height,
                    opacity: self.opacity,
                    active,
                });
            }
        }
        AsciiSweepPlan {
            font: self.font.clone(),
            font_size: self.font_size,
            cell_width,
            line_height,
            color: self.color,
            active_color: self.active_color,
            glyphs,
        }
    }
}

fn number(rule: NumberRule, unit: &str) -> Value {
    let mut value = serde_json::to_value(rule).expect("finite ASCII Sweep rule");
    value["type"] = json!("number");
    value["unit"] = json!(unit);
    value
}

pub(super) fn catalog_entry() -> Value {
    let text = |suggested: &str| {
        json!({"type":"text", "minLength":1, "maxLength":MAX_TEXT_SCALARS,
        "lengthUnit":"unicode-scalars", "maxUtf8Bytes":MAX_TEXT_BYTES, "maxLines":MAX_ROWS,
        "maxColumns":MAX_COLUMNS, "lineSeparator":"LF", "otherControlCharacters":false,
        "suggested":suggested})
    };
    let rgba = |suggested: Color| json!({"type":"rgba", "min":0, "max":1, "length":4, "suggested":suggested});
    json!({
        "requires":["canvas-worker-2d", "declared-font-resource"],
        "binding":"scene.settings plus scene.role, scene.span and scene.easing",
        "clock":"explicit source-frame span -> eased progress; ref remaps source time; no accumulated state",
        "parameters":{
            "font":{"type":"resource", "kind":"font"},
            "textA":text("HELLO WORLD"), "textB":text("READY TO GO"),
            "glyphs":{"type":"text", "minLength":1, "maxLength":MAX_GLYPHS,
                "lengthUnit":"unicode-scalars", "controlCharacters":false, "suggested":"01#+"},
            "rect":{"type":"tuple", "items":[number(RECT_POSITION,"frame-width"),number(RECT_POSITION,"frame-height"),number(RECT_EXTENT,"frame-width"),number(RECT_EXTENT,"frame-height")]},
            "fontSize":number(FONT_SIZE,"pixels"), "bandWidth":number(BAND_WIDTH,"rect-width"),
            "color":rgba([1.0,1.0,1.0,1.0]), "activeColor":rgba([0.2,1.0,0.6,1.0]),
            "opacity":number(OPACITY,"ratio"),
            "direction":{"type":"enum", "options":[SweepDirection::LeftToRight,SweepDirection::RightToLeft], "suggested":"leftToRight"}
        },
        "layout":{"cellWidthFontRatio":CELL_ADVANCE,"lineHeightFontRatio":LINE_ADVANCE,
            "anchor":"rect top-left; glyph cell center; textAlign center; textBaseline middle"},
        "constraints":["rect entirely inside frame", "union text grid must fit rect at fontSize; reject instead of truncating",
            "max columns across both texts * max rows across both texts charged to expanded primitive budget"],
        "endpoints":"progress 0 = textA; progress 1 = textB; direction changes scan order, not endpoints",
        "seed":"source.seed selects active-band glyphs at floor(progress * 256); no wall clock",
        "limitations":["individual Unicode scalars, not shaped text", "author must ensure declared font glyph coverage",
            "LF is the only accepted text control character", "explicit spaces can scramble; absent padding cells stay empty"]
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_bounds_count_unicode_scalars_and_keep_empty_lines() {
        assert_eq!(text_shape("\n\u{754c}\u{1f642}e\u{301}\n"), Some((4, 3)));
        assert_eq!(
            text_shape(&"\u{1f642}".repeat(MAX_COLUMNS)),
            Some((MAX_COLUMNS, 1))
        );
        assert!(text_shape(&"\u{1f642}".repeat(MAX_COLUMNS + 1)).is_none());
        assert!(text_shape("a\r\nb").is_none());
        assert!(text_shape("a\tb").is_none());
        assert!(text_shape(&"\n".repeat(MAX_ROWS)).is_none());
    }

    #[test]
    fn catalog_suggestions_share_the_validated_rules() {
        let entry = catalog_entry();
        let parameters = entry["parameters"].as_object().unwrap();
        let mut settings = serde_json::Map::new();
        for (key, field) in parameters {
            let value = match field["type"].as_str().unwrap() {
                "resource" => json!("font.ttf"),
                "tuple" => field["items"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|v| v["suggested"].clone())
                    .collect(),
                _ => field["suggested"].clone(),
            };
            settings.insert(key.clone(), value);
        }
        let sweep: AsciiSweep = serde_json::from_value(Value::Object(settings.clone())).unwrap();
        assert!(sweep.valid() && sweep.fits(640.0, 360.0));
        assert_eq!(sweep.work(), 11);
        for (key, field) in parameters {
            if field["type"] != "number" {
                continue;
            }
            for value in [
                field["min"].as_f64().unwrap() - 0.01,
                field["max"].as_f64().unwrap() + 0.01,
            ] {
                let mut invalid = settings.clone();
                invalid.insert(key.clone(), json!(value));
                assert!(
                    !serde_json::from_value::<AsciiSweep>(Value::Object(invalid))
                        .unwrap()
                        .valid(),
                    "{key}"
                );
            }
        }
    }
}

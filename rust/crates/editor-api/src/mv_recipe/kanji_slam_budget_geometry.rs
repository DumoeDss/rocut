//! Whole-source preflight using producer lifetimes, not a second renderer.
use super::super::{
    glyph_art,
    model::{Axis, KanjiSlam},
};
use crate::{mv_font_metrics, mv_image_dimensions};
use std::collections::{BTreeMap, BTreeSet};

const FRAME: u64 = 1920 * 1080;
const GRAIN: u64 = 2 * 256 * 256;
const RECT_PAYLOAD_PER_GLYPH: u64 = 2600 * 128;
const NOISE_PAYLOAD: u64 = 9 * 128 * 128;
const FIRE_SURFACES: u64 = 2 * 128 * 128 + 4 * 2 * 480 * 270;

fn chars(word: &str) -> BTreeSet<char> {
    word.chars().collect()
}

// The producer appends in authored order and releases each character at its
// last occurrence. Repeated interleaved letters retain their real overlap.
fn stream_peak(word: &str, ink: &BTreeMap<char, u64>, copies: u64) -> u64 {
    let word: Vec<_> = word.chars().collect();
    let mut active = BTreeSet::new();
    let (mut live, mut peak) = (0, 0);
    for (index, ch) in word.iter().enumerate() {
        if active.insert(*ch) {
            live += copies * ink[ch];
            peak = peak.max(live);
        }
        if !word[index + 1..].contains(ch) {
            active.remove(ch);
            live -= copies * ink[ch];
        }
    }
    peak
}

pub(super) fn static_floor(a: &KanjiSlam) -> u64 {
    let live = a
        .glyphs
        .iter()
        .map(|s| chars(s).len() as u64)
        .max()
        .unwrap_or(0);
    // Scene/finished or scene/heat overlap with two backing/copy allowances.
    // Keep known rect transport and fixed fire/noise/grain costs; do not guess
    // character dimensions or font ink. The public decoder reserve is unchanged.
    4 * FRAME
        + GRAIN
        + live * RECT_PAYLOAD_PER_GLYPH
        + if a.fire {
            NOISE_PAYLOAD + FIRE_SURFACES
        } else {
            0
        }
}

pub(super) fn validate(
    a: &KanjiSlam,
    fonts: &mv_font_metrics::Context,
    images: &mv_image_dimensions::Context,
    limit: u64,
) -> Result<(), String> {
    let image = images.image(&a.character)?;
    let (w, h) = (u64::from(image.width), u64::from(image.height));
    let pad = ((a.wind.amp * 1.6).ceil() + 2.0) as u64;
    let padded = if a.wind.axis == Axis::Col {
        w * (h + 2 * pad)
    } else {
        (w + 2 * pad) * h
    };
    // tint/band/inner or tint/inner/halo, including the largest 16px blur.
    let mask_peak = (6 * w * h + 2 * (w + 96) * (h + 96)).max(4 * w * h + 6 * padded);
    let character = 2 * padded * (4 + u64::from(a.night()) + u64::from(a.fire));
    let mut ink = BTreeMap::new();
    for ch in a.glyphs.iter().flat_map(|s| s.chars()) {
        let art = glyph_art::geometry(ch, 0, a, fonts)?;
        ink.insert(ch, u64::from(art.size[0]) * u64::from(art.size[1]));
    }
    for (index, word) in a.glyphs.iter().enumerate() {
        let live = chars(word);
        // Previous ghosts are appended/released before live glyph art. Check
        // every authored word even when its shot is not the requested sample.
        let ghost = index
            .checked_sub(1)
            .map_or(0, |i| stream_peak(&a.glyphs[i], &ink, 2));
        let payload =
            live.len() as u64 * RECT_PAYLOAD_PER_GLYPH + if a.fire { NOISE_PAYLOAD } else { 0 };
        // Largest glow scratch fits inside the105px-padded art. It exists while
        // fill/line/edge are live, before shadow allocation; four final surfaces
        // therefore also bound that temporary (three surfaces + one filter).
        let glyphs = stream_peak(word, &ink, 2 * (3 + u64::from(a.fire))).max(ghost);
        let fire = if a.fire { FIRE_SURFACES } else { 0 };
        let layer = 2 * FRAME + if a.fire { 2 * 480 * 270 } else { 0 };
        let preparation = character + (layer + glyphs).max(2 * FRAME + fire);
        let composition = character + 4 * FRAME;
        let finishing = 4 * FRAME + GRAIN;
        let peak = mask_peak
            .max(character)
            .max(preparation)
            .max(composition)
            .max(finishing)
            + payload;
        if peak > limit {
            return Err(format!(
                "kanjiSlam measured whole-source scratch exceeds40Mi envelope: word={index}, peak={peak}, limit={limit}, glyphs={glyphs}, character={character}, payload={payload}"
            ));
        }
    }
    Ok(())
}

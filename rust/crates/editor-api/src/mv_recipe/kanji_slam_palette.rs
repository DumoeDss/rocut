use crate::mv_recipe::model::Color;
pub(super) const fn rgb(hex: u32) -> Color {
    [
        ((hex >> 16) & 255) as f64 / 255.0,
        ((hex >> 8) & 255) as f64 / 255.0,
        (hex & 255) as f64 / 255.0,
        1.0,
    ]
}
pub(super) const INK: Color = rgb(0x140b1e);
pub(super) const DUSK: Color = rgb(0x7a2350);
pub(super) const SUNSET: Color = rgb(0xf0663a);
pub(super) const GLOW: Color = rgb(0xffa552);
pub(super) const HI: Color = rgb(0xffe3b0);
pub(super) const CYAN: Color = rgb(0x39c6e0);
pub(super) fn rgb255(color: Color) -> [f64; 3] {
    [color[0] * 255.0, color[1] * 255.0, color[2] * 255.0]
}
pub(super) fn mix(a: [f64; 3], b: [f64; 3], k: f64) -> [f64; 3] {
    std::array::from_fn(|i| a[i] + (b[i] - a[i]) * k)
}
pub(super) fn css(rgb: [f64; 3], alpha: f64) -> Color {
    [
        rgb[0].trunc() / 255.0,
        rgb[1].trunc() / 255.0,
        rgb[2].trunc() / 255.0,
        alpha,
    ]
}
pub(super) fn mixed(a: Color, b: Color, k: f64, alpha: f64) -> Color {
    css(mix(rgb255(a), rgb255(b), k.clamp(0.0, 1.0)), alpha)
}

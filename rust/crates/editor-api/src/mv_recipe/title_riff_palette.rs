use crate::mv_recipe::model::Color;
pub(super) struct Palette {
    pub void: Color,
    pub ink: Color,
    pub dusk: Color,
    pub verm: Color,
    pub sunset: Color,
    pub glow: Color,
    pub hi: Color,
    pub core: Color,
}
pub(super) const fn rgb(hex: u32) -> Color {
    [
        ((hex >> 16) & 255) as f64 / 255.0,
        ((hex >> 8) & 255) as f64 / 255.0,
        (hex & 255) as f64 / 255.0,
        1.0,
    ]
}
pub(super) fn palette(outro: bool) -> Palette {
    if outro {
        Palette {
            void: rgb(0x07051a),
            ink: rgb(0x120d24),
            dusk: rgb(0x9a6aa0),
            verm: rgb(0xe0707e),
            sunset: rgb(0xf3a6a0),
            glow: rgb(0xffd9b0),
            hi: rgb(0xfffaf0),
            core: rgb(0xffffff),
        }
    } else {
        Palette {
            void: rgb(0x050208),
            ink: rgb(0x140b1e),
            dusk: rgb(0x7a2350),
            verm: rgb(0xc8373a),
            sunset: rgb(0xf0663a),
            glow: rgb(0xffa552),
            hi: rgb(0xffe3b0),
            core: rgb(0xfff6e6),
        }
    }
}

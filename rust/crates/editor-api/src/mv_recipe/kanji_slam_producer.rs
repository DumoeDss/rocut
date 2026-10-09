use super::{
    Sample,
    character::{self, Character},
    clock::Clock,
    draw::*,
    fire, glyphs, impacts,
    model::KanjiSlam,
    plan::*,
    raster::*,
    sky,
    state::State,
};
use crate::{mv_font_metrics, mv_image_dimensions};
impl KanjiSlam {
    pub(in crate::mv_recipe) fn produce(
        &self,
        sample: &Sample<'_>,
        width: u32,
        height: u32,
        fonts: &mv_font_metrics::Context,
        images: &mv_image_dimensions::Context,
    ) -> Result<Plan, String> {
        self.runtime_ready(sample, fonts, images)?;
        let c = Clock::new(self, sample)?;
        let s = State::new(self, &c);
        let character = Character::new(self, &c, images)?;
        let mut commands = Vec::new();
        // Original character buffers precede glyph art; dependencies retain
        // their canvas sizes and every later layer samples the same surfaces.
        character::prepare(&mut commands, self, &c, &character);
        let arts = glyphs::prepare(&mut commands, self, &s, fonts)?;
        if self.fire {
            fire::prepare(&mut commands, &c, &s, &arts);
        }
        let mut glyph_layer = Draw::new(1920.0, 1080.0);
        glyph_layer.operations = s.camera(1.0);
        if !s.previous.is_empty() {
            glyphs::word(
                &mut glyph_layer,
                self,
                &s.previous,
                &arts,
                1.02 + c.elapsed * 0.12,
                0.85 * (-c.elapsed * 5.5).exp(),
                0.0,
                0.0,
            );
        }
        glyphs::word(
            &mut glyph_layer,
            self,
            &s.glyphs,
            &arts,
            s.glyph_scale,
            0.0,
            s.smear,
            s.burn,
        );
        glyph_layer.operations = s.camera(1.15);
        character.draw(
            &mut glyph_layer,
            "ks-cast",
            character.x - 70.0,
            character.y + 26.0 + character.bob,
            if self.night() { 0.55 } else { 0.42 },
            "source-atop",
        );
        glyph_layer.operations.clear();
        if self.fire {
            fire::draw(&mut glyph_layer);
        }
        surface(&mut commands, "ks-glyph-layer", [1920, 1080], glyph_layer);
        glyphs::release_all(&mut commands, self, &arts);
        if self.fire {
            fire::release_all(&mut commands);
        }
        let mut scene = Draw::new(1920.0, 1080.0);
        sky::draw(&mut scene, self, &c, &s, images)?;
        all(
            &mut scene,
            "ks-glyph-layer",
            [1920, 1080],
            FRAME,
            "source-over",
            1.0,
            0.0,
        );
        impacts::draw(&mut scene, self, &c, &s, &character);
        character::draw(&mut scene, self, &c, &s, &character);
        impacts::particles(&mut scene, self, &c, &s);
        surface(&mut commands, "ks-scene", [1920, 1080], scene);
        release(&mut commands, "ks-glyph-layer");
        character::release_all(&mut commands, self);
        if self.fire {
            fire::heat_haze(&mut commands, &c);
            release(&mut commands, "ks-scene");
        }
        let source = if self.fire { "ks-heat" } else { "ks-scene" };
        let mut finished = Draw::new(1920.0, 1080.0);
        all(
            &mut finished,
            source,
            [1920, 1080],
            FRAME,
            "source-over",
            1.0,
            0.0,
        );
        super::finishing::draw(&mut finished, self, &c, &s, fonts)?;
        surface(&mut commands, "ks-finished", [1920, 1080], finished);
        release(&mut commands, source);
        let mut target = Draw::new(width as f64, height as f64);
        all(
            &mut target,
            "ks-finished",
            [1920, 1080],
            FRAME,
            "source-over",
            1.0,
            0.0,
        );
        commands.extend(target.commands);
        release(&mut commands, "ks-finished");
        let plan = Plan { commands };
        self.verify_plan(&plan, fonts, images)?;
        Ok(plan)
    }
}

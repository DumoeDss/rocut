use super::{
    Sample, background,
    character::{self, Character},
    clock::Clock,
    draw::Draw,
    finishing, geometry,
    model::Fall,
    plan::Plan,
    raster::*,
    ribbon::Ribbon,
    streaks,
};
use crate::mv_image_dimensions::Context;
impl Fall {
    pub(in crate::mv_recipe) fn produce(
        &self,
        sample: &Sample<'_>,
        width: u32,
        height: u32,
        images: &Context,
    ) -> Result<Plan, String> {
        self.runtime_ready(sample, images)?;
        let clock = Clock::new(self, sample)?;
        let v = clock.speed(self.speed, clock.held);
        let dist = clock.distance(self.speed);
        let character = Character::new(self, &clock, images)?;
        let ribbon = Ribbon::new(&geometry::ribbon(&character, &clock, v), clock.quantized);
        let mut commands = vec![];
        background::prepare(&mut commands, self, &clock);
        character::prepare(&mut commands, self, &clock, &character, v);
        finishing::prepare(&mut commands);
        ribbon.prepare(&mut commands, &clock);
        let mut scene = Draw::new(1920.0, 1080.0);
        background::draw(&mut scene, self, &clock);
        streaks::draw(&mut scene, self, &clock, dist, v);
        character::draw(&mut scene, &clock, &character, v);
        ribbon.draw(&mut scene);
        finishing::draw(&mut scene, self, dist, v);
        surface(&mut commands, "fa-scene", [1920, 1080], scene);
        for id in [
            "fa-cone",
            "fa-lit",
            "fa-warm",
            "fa-cold",
            "fa-streak",
            "fa-wide",
            "fa-near",
        ] {
            release(&mut commands, id);
        }
        let mut output = Draw::new(width as f64, height as f64);
        all(
            &mut output,
            "fa-scene",
            [1920, 1080],
            FRAME,
            "source-over",
            1.0,
            0.0,
        );
        commands.extend(output.commands);
        release(&mut commands, "fa-scene");
        let plan = Plan { commands };
        self.verify_plan(&plan, images)?;
        Ok(plan)
    }
}

use super::{
    Sample, background,
    clock::Clock,
    draw::Draw,
    finishing, geometry,
    hand::{self, Hand},
    model::Thread,
    plan::Plan,
    raster::*,
    ribbon::Ribbon,
    state::State,
};
use crate::mv_image_dimensions::Context;

impl Thread {
    pub(in crate::mv_recipe) fn produce(
        &self,
        sample: &Sample<'_>,
        width: u32,
        height: u32,
        images: &Context,
    ) -> Result<Plan, String> {
        self.runtime_ready(sample, images)?;
        let clock = Clock::new(self, sample)?;
        let state = State::new(&clock);
        let hand = Hand::new(self, &clock, images)?;
        let path = geometry::visible(self, &clock, &state, &hand);
        let ribbon = Ribbon::new(&path, &clock);
        let mut commands = vec![];
        background::prepare(&mut commands);
        hand::prepare(&mut commands, self, &state, &hand);
        ribbon.prepare(&mut commands, &state);
        let mut scene = Draw::new(1920.0, 1080.0);
        background::draw(&mut scene, self, &clock, &state);
        hand::draw(&mut scene, &state, &hand);
        ribbon.draw(&mut scene, &state);
        finishing::main(&mut scene, self, &clock, &state, *path.last().unwrap());
        finishing::foreground(&mut scene, &clock, &state);
        surface(&mut commands, "th-scene", [1920, 1080], scene);
        for id in [
            "th-neb-v", "th-neb-r", "th-lit", "th-rim", "th-wide", "th-near",
        ] {
            release(&mut commands, id);
        }
        let mut output = Draw::new(width as f64, height as f64);
        all(
            &mut output,
            "th-scene",
            [1920, 1080],
            FRAME,
            "source-over",
            1.0,
            0.0,
        );
        commands.extend(output.commands);
        release(&mut commands, "th-scene");
        let plan = Plan { commands };
        self.verify_plan(&plan, images)?;
        Ok(plan)
    }
}

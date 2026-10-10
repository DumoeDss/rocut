use super::{
    Sample, background, character::Character, clock::Clock, draw::Draw, layers, model::Ink,
    network::Network, plan::Plan, raster::*, texture,
};
use crate::mv_image_dimensions::Context;
impl Ink {
    pub(in crate::mv_recipe) fn produce(
        &self,
        sample: &Sample<'_>,
        width: u32,
        height: u32,
        images: &Context,
    ) -> Result<Plan, String> {
        self.runtime_ready(sample, images)?;
        if width == 0 || height == 0 {
            return Err("Ink output dimensions must be nonzero".into());
        }
        let clock = Clock::new(self, sample)?;
        let network = Network::new(self.network_seed());
        let character = Character::new(self, images)?;
        let mut commands = vec![];
        texture::prepare(&mut commands);
        let mut scene = Draw::new(1920., 1080.);
        background::draw(&mut scene, &clock);
        surface(&mut commands, "ik-scene", [1920, 1080], scene);
        release(&mut commands, "ik-fog");
        layers::pools(&mut commands, &clock, &network);
        layers::tendrils(&mut commands, &clock, &network, false);
        character.draw(&mut commands, self, &clock);
        layers::tendrils(&mut commands, &clock, &network, true);
        release(&mut commands, "ik-mot");
        release(&mut commands, "ik-mot2");
        let mut finish = Draw::new(1920., 1080.);
        background::vignette(&mut finish);
        append(&mut commands, "ik-scene", finish);
        let mut output = Draw::new(width as f64, height as f64);
        all(
            &mut output,
            "ik-scene",
            [1920, 1080],
            FRAME,
            "source-over",
            1.,
            0.,
        );
        commands.extend(output.commands);
        release(&mut commands, "ik-scene");
        let plan = Plan { commands };
        self.verify_plan(&plan, images)?;
        Ok(plan)
    }
}

use super::{
    Sample,
    clock::Clock,
    dark::{self, Dark},
    draw::Draw,
    hands::{self, Hands},
    model::{Flame, Mode},
    plan,
    raster::*,
};
use crate::{mv_image_dimensions::Context, programmatic_resources::Resource};
impl Flame {
    pub(in crate::mv_recipe) fn produce(
        &self,
        sample: &Sample<'_>,
        width: u32,
        height: u32,
        images: &Context,
        resources: &[Resource],
    ) -> Result<super::Plan, String> {
        self.runtime_ready(sample, images, resources)?;
        let c = Clock::new(self, sample)?;
        let mut commands = vec![];
        let mut scene = Draw::new(1920.0, 1080.0);
        if self.mode == Mode::Dark {
            let f = Dark::new(self, &c, images)?;
            dark::prepare(&mut commands, self, &c, &f);
            dark::draw(&mut scene, &c, &f);
            surface(&mut commands, "fl-scene", [1920, 1080], scene);
            if f.active() {
                release(&mut commands, "fl-lit");
                release(&mut commands, "fl-rim");
            }
        } else {
            let h = Hands::new(self, &c, images)?;
            hands::prepare(&mut commands, self, &h, resources)?;
            hands::draw(&mut scene, self, &c, &h);
            surface(&mut commands, "fl-scene", [1920, 1080], scene);
            release(&mut commands, "fl-lit");
            release(&mut commands, "fl-fingers");
        }
        let mut output = Draw::new(width as f64, height as f64);
        all(
            &mut output,
            "fl-scene",
            [1920, 1080],
            FRAME,
            "source-over",
            1.0,
            0.0,
        );
        commands.extend(output.commands);
        release(&mut commands, "fl-scene");
        let plan = plan::Plan { commands };
        self.verify_plan(&plan, images)?;
        Ok(super::Plan {
            commands: plan.commands,
            raster_budget_bytes: self
                .render_pixels(images)?
                .checked_mul(4)
                .ok_or("flame raster budget overflow")?,
        })
    }
}

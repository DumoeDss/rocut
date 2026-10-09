use super::{
    Sample,
    clock::Clock,
    dark::Dark,
    hands::Hands,
    model::{Flame, Mode},
    plan::{Command, Plan, Step},
};
use crate::{
    mv_image_dimensions::Context,
    mv_image_preprocess::{ALGORITHM, Binding},
    programmatic_resources::Resource,
};
const FRAME: u64 = 1920 * 1080;
const MAX_PLAN_BYTES: usize = 1024 * 1024;
impl Flame {
    pub(in crate::mv_recipe) fn work(&self) -> u32 {
        1024
    }
    pub(in crate::mv_recipe) fn plan_pixels(&self) -> u64 {
        (MAX_PLAN_BYTES as u64 * 3 + 3) / 4
    }
    fn roi_pixels(&self, images: &Context) -> Result<u64, String> {
        let image = images.image(self.image())?;
        let roi = crate::mv_image_preprocess::roi_for_dimensions(
            image.width,
            image.height,
            self.landmarks(image.width, image.height),
        )?;
        u64::from(roi.width)
            .checked_mul(u64::from(roi.height))
            .ok_or_else(|| "flame ROI budget overflow".into())
    }
    pub(super) fn render_pixels(&self, images: &Context) -> Result<u64, String> {
        let image = images.image(self.image())?;
        let pixels = u64::from(image.width) * u64::from(image.height);
        if image.width > 4096 || image.height > 4096 || image.width < 2 {
            return Err("flame image requires dimensions in2..4096".into());
        }
        if self.mode != Mode::Dark {
            // Lit-mask/lit/fingers/scene lifetimes have a 6-frame backing peak.
            // Base is full image backing; ROI upload plus transport/readback is
            // retained across release. Owner also charges its persistent cache.
            return Ok(6 * FRAME + 2 * pixels + 3 * self.roi_pixels(images)? + 5120);
        }
        // lit/tint/rim overlap: up to 6 image backings plus lit mask/frame.
        // Blur is per warped blit. Bound either source-space or projected
        // diagonal; never flatten the 37 blits into one post blur.
        let scale = self.h / image.height as f64 * 1.045 * (1.0 + 0.006 * 1.55);
        let diagonal = ((image.width as f64).hypot(image.height as f64) * scale).ceil();
        if !diagonal.is_finite() || diagonal + 24.0 > 8192.0 {
            return Err(
                "flame dark projected per-blit blur exceeds bounded scratch dimensions".into(),
            );
        }
        let blur = 2
            * ((image.width as u64 + 24) * (image.height as u64 + 24))
                .max((diagonal as u64 + 24).pow(2));
        Ok(6 * FRAME + 6 * pixels + blur)
    }
    pub(in crate::mv_recipe) fn scratch_pixels(
        &self,
        images: Option<&Context>,
    ) -> Result<u64, String> {
        let Some(images) = images else {
            return Ok(6 * FRAME);
        };
        let render = self.render_pixels(images)?;
        if self.mode == Mode::Dark {
            return Ok(render);
        }
        let image = images.image(self.image())?;
        let pixels = u64::from(image.width) * u64::from(image.height);
        // Preparation is sequential before the scene. Include full-image
        // readback Canvas plus conservative core/input/output/metadata peak.
        let prepare = 2 * pixels + (34 * self.roi_pixels(images)? + 20480 + 3) / 4;
        Ok(render.max(prepare))
    }
    pub(in crate::mv_recipe) fn runtime_ready(
        &self,
        s: &Sample<'_>,
        images: &Context,
        resources: &[Resource],
    ) -> Result<(), String> {
        let c = Clock::new(self, s)?;
        self.scratch_pixels(Some(images))?;
        if self.mode == Mode::Dark {
            Dark::new(self, &c, images)?;
        } else {
            let h = Hands::new(self, &c, images)?;
            let resource = resources
                .iter()
                .find(|r| r.id == self.image() && r.kind == "image")
                .ok_or("flame declared image is missing")?
                .clone();
            Binding {
                resource,
                width: h.image[0],
                height: h.image[1],
                flame_at: h.fa,
                algorithm: ALGORITHM.into(),
            }
            .roi()?;
        }
        Ok(())
    }
    pub(super) fn verify_plan(&self, p: &Plan, images: &Context) -> Result<(), String> {
        let mut count = 0;
        let mut steps = 0;
        for command in &p.commands {
            let children = match command {
                Command::Surface { commands, .. } | Command::AppendSurface { commands, .. } => {
                    commands.as_slice()
                }
                _ => &[],
            };
            for c in std::iter::once(command).chain(children) {
                count += 1;
                if let Command::Path { path, .. } = c {
                    steps += path
                        .iter()
                        .map(|v| if matches!(v, Step::Rect { .. }) { 5 } else { 1 })
                        .sum::<usize>();
                }
            }
        }
        if count > 1024 || steps > 12000 {
            return Err("flame exceeds1024commands/12000path steps".into());
        }
        p.validate_surfaces(self.render_pixels(images)?)?;
        if serde_json::to_vec(p).map_err(|e| e.to_string())?.len() > MAX_PLAN_BYTES {
            return Err("flame exceeds1MiB serialized plan/copy budget".into());
        }
        Ok(())
    }
}

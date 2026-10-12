use std::collections::HashMap;

use gpu::{GpuContext, wgpu};

type TextureKey = (u32, u32);

#[derive(Default)]
pub struct TexturePool {
    available: HashMap<TextureKey, Vec<wgpu::Texture>>,
    in_use: Vec<(TextureKey, wgpu::Texture)>,
}

impl TexturePool {
    pub(crate) fn resident_rgba_bytes(&self) -> Option<u64> {
        self.available
            .values()
            .flatten()
            .chain(self.in_use.iter().map(|(_, texture)| texture))
            .try_fold(0u64, |total, texture| {
                total.checked_add(
                    u64::from(texture.width())
                        .checked_mul(u64::from(texture.height()))?
                        .checked_mul(4)?,
                )
            })
    }

    pub fn recycle_frame(&mut self) {
        for (key, texture) in self.in_use.drain(..) {
            self.available.entry(key).or_default().push(texture);
        }
    }

    pub fn acquire(
        &mut self,
        context: &GpuContext,
        width: u32,
        height: u32,
        label: &'static str,
    ) -> wgpu::Texture {
        let key = (width, height);
        let texture = self
            .available
            .get_mut(&key)
            .and_then(Vec::pop)
            .unwrap_or_else(|| context.create_render_texture(width, height, label));
        self.in_use.push((key, texture.clone()));
        texture
    }
}

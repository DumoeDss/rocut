use std::collections::HashMap;

use gpu::wgpu;

pub struct StoredTexture {
    texture: wgpu::Texture,
}

impl StoredTexture {
    pub fn new(texture: wgpu::Texture) -> Self {
        Self { texture }
    }

    pub fn texture(&self) -> &wgpu::Texture {
        &self.texture
    }
}

#[derive(Default)]
pub struct TextureStore {
    textures: HashMap<String, StoredTexture>,
}

impl TextureStore {
    pub fn upsert(&mut self, id: String, texture: wgpu::Texture) {
        self.textures.insert(id, StoredTexture::new(texture));
    }

    pub fn get(&self, id: &str) -> Option<&StoredTexture> {
        self.textures.get(id)
    }

    pub fn remove(&mut self, id: &str) {
        self.textures.remove(id);
    }

    pub(crate) fn resident_rgba_bytes(&self) -> Option<u64> {
        self.textures.values().try_fold(0u64, |total, stored| {
            let texture = stored.texture();
            total.checked_add(
                u64::from(texture.width())
                    .checked_mul(u64::from(texture.height()))?
                    .checked_mul(4)?,
            )
        })
    }
}

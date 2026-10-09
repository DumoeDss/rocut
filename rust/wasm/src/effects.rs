#![cfg(target_arch = "wasm32")]

use effects::{ApplyEffectsOptions, EffectPass, UniformValue};
use gpu::wgpu;
use js_sys::Object;
use serde::Deserialize;
use wasm_bindgen::{JsCast, JsValue, prelude::wasm_bindgen};

use crate::gpu::{
    GpuRuntime, import_canvas_texture, read_offscreen_canvas_property, read_serde_property,
    read_u32_property, render_texture_to_canvas, with_gpu_runtime,
};

pub(crate) struct ApplyEffectPassesOptions {
    source: wgpu::web_sys::OffscreenCanvas,
    pub(crate) width: u32,
    pub(crate) height: u32,
    passes: Vec<EffectPassInput>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EffectPassInput {
    shader: String,
    uniforms: Vec<EffectUniformInput>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EffectUniformInput {
    name: String,
    value: Vec<f32>,
}

#[wasm_bindgen(js_name = applyEffectPasses)]
pub fn apply_effect_passes(options: JsValue) -> Result<wgpu::web_sys::OffscreenCanvas, JsValue> {
    let options = parse_apply_effect_passes_options(options)?;
    let (width, height) = (options.width, options.height);
    with_gpu_runtime(|runtime| {
        let result_texture = apply_effect_passes_to_texture(runtime, options)?;
        render_texture_to_canvas(&runtime.context, &result_texture, width, height)
    })
}

pub(crate) fn apply_effect_passes_to_texture(
    runtime: &GpuRuntime,
    options: ApplyEffectPassesOptions,
) -> Result<wgpu::Texture, JsValue> {
    let ApplyEffectPassesOptions {
        source,
        width,
        height,
        passes,
    } = options;

    let source_texture = import_canvas_texture(
        &runtime.context,
        &source,
        width,
        height,
        "effects-input-texture",
    );
    let effect_passes = map_effect_passes(passes);
    runtime
        .effects
        .apply(
            &runtime.context,
            ApplyEffectsOptions {
                source: &source_texture,
                width,
                height,
                passes: &effect_passes,
            },
        )
        .map_err(|error| JsValue::from_str(&error.to_string()))
}

fn map_effect_passes(effect_passes: Vec<EffectPassInput>) -> Vec<EffectPass> {
    effect_passes
        .into_iter()
        .map(|pass| EffectPass {
            shader: pass.shader,
            uniforms: pass
                .uniforms
                .into_iter()
                .map(|uniform| {
                    let value = if uniform.value.len() == 1 {
                        UniformValue::Number(uniform.value[0])
                    } else {
                        UniformValue::Vector(uniform.value)
                    };
                    (uniform.name, value)
                })
                .collect(),
        })
        .collect()
}

pub(crate) fn parse_apply_effect_passes_options(
    value: JsValue,
) -> Result<ApplyEffectPassesOptions, JsValue> {
    let object: Object = value
        .dyn_into()
        .map_err(|_| JsValue::from_str("applyEffectPasses expects an options object"))?;

    Ok(ApplyEffectPassesOptions {
        source: read_offscreen_canvas_property(&object, "source")?,
        width: read_u32_property(&object, "width")?,
        height: read_u32_property(&object, "height")?,
        passes: read_serde_property(&object, "passes")?,
    })
}

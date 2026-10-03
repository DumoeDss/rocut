use effects::{ApplyEffectsOptions, ColorAdjustment, EffectPass, EffectPipeline, UniformValue};
use gpu::GpuContext;
use std::{
    future::Future,
    pin::pin,
    sync::Arc,
    task::{Context, Poll, Wake, Waker},
    time::Duration,
};

struct ThreadWake(std::thread::Thread);
impl Wake for ThreadWake {
    fn wake(self: Arc<Self>) {
        self.0.unpark();
    }
}
fn block_on<F: Future>(future: F) -> F::Output {
    let waker = Waker::from(Arc::new(ThreadWake(std::thread::current())));
    let mut cx = Context::from_waker(&waker);
    let mut future = pin!(future);
    let deadline = std::time::Instant::now() + Duration::from_secs(30);
    loop {
        if let Poll::Ready(value) = future.as_mut().poll(&mut cx) {
            return value;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "GPU initialization timed out"
        );
        std::thread::park_timeout(Duration::from_millis(10));
    }
}
fn render(context: &GpuContext, pipeline: &EffectPipeline, params: ColorAdjustment) -> [u8; 4] {
    let source = context.create_render_texture(1, 1, "adjustment-test-source");
    let bgra = context.texture_format() == wgpu::TextureFormat::Bgra8Unorm;
    let bytes = if bgra {
        [32, 64, 128, 128]
    } else {
        [128, 64, 32, 128]
    };
    context.queue().write_texture(
        source.as_image_copy(),
        &bytes,
        wgpu::TexelCopyBufferLayout {
            offset: 0,
            bytes_per_row: Some(4),
            rows_per_image: Some(1),
        },
        wgpu::Extent3d {
            width: 1,
            height: 1,
            depth_or_array_layers: 1,
        },
    );
    let pass = EffectPass {
        shader: "color-adjustment".into(),
        uniforms: [
            ("exposure", params.exposure),
            ("contrast", params.contrast),
            ("saturation", params.saturation),
            ("temperature", params.temperature),
            ("tint", params.tint),
        ]
        .into_iter()
        .map(|(key, value)| (key.into(), UniformValue::Number(value)))
        .collect(),
    };
    let output = pipeline
        .apply(
            context,
            ApplyEffectsOptions {
                source: &source,
                width: 1,
                height: 1,
                passes: &[pass],
            },
        )
        .unwrap();
    let buffer = context.device().create_buffer(&wgpu::BufferDescriptor {
        label: Some("adjustment-readback"),
        size: 256,
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });
    let mut encoder = context
        .device()
        .create_command_encoder(&wgpu::CommandEncoderDescriptor::default());
    encoder.copy_texture_to_buffer(
        output.as_image_copy(),
        wgpu::TexelCopyBufferInfo {
            buffer: &buffer,
            layout: wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(256),
                rows_per_image: Some(1),
            },
        },
        wgpu::Extent3d {
            width: 1,
            height: 1,
            depth_or_array_layers: 1,
        },
    );
    context.queue().submit([encoder.finish()]);
    let (tx, rx) = std::sync::mpsc::channel();
    buffer
        .slice(..)
        .map_async(wgpu::MapMode::Read, move |result| {
            tx.send(result).unwrap();
        });
    context
        .device()
        .poll(wgpu::PollType::Wait {
            submission_index: None,
            timeout: Some(Duration::from_secs(10)),
        })
        .unwrap();
    rx.recv_timeout(Duration::from_secs(10)).unwrap().unwrap();
    let bytes = buffer.slice(..).get_mapped_range();
    let rgba = if bgra {
        [bytes[2], bytes[1], bytes[0], bytes[3]]
    } else {
        [bytes[0], bytes[1], bytes[2], bytes[3]]
    };
    drop(bytes);
    buffer.unmap();
    rgba
}
#[test]
#[ignore = "requires a native GPU; run cargo test -p effects --test color_gpu -- --ignored"]
fn color_shader_preserves_straight_alpha_and_applies_all_controls() {
    let context = block_on(GpuContext::new()).expect("native GPU unavailable");
    let pipeline = EffectPipeline::new(&context);
    let neutral = ColorAdjustment::default();
    let base = render(&context, &pipeline, neutral);
    for (actual, expected) in base.into_iter().zip([128u8, 64, 32, 128]) {
        assert!(
            actual.abs_diff(expected) <= 1,
            "neutral straight-alpha identity: {base:?}"
        );
    }
    let mono = render(
        &context,
        &pipeline,
        ColorAdjustment {
            saturation: -100.0,
            ..neutral
        },
    );
    assert!(mono[0].abs_diff(mono[1]) <= 1 && mono[1].abs_diff(mono[2]) <= 1);
    let exposed = render(
        &context,
        &pipeline,
        ColorAdjustment {
            exposure: 1.0,
            ..neutral
        },
    );
    assert!(exposed[0] > base[0] + 30 && exposed[1] > base[1] + 15);
    let contrast = render(
        &context,
        &pipeline,
        ColorAdjustment {
            contrast: 30.0,
            ..neutral
        },
    );
    assert!(contrast[1] < base[1]);
    let warm = render(
        &context,
        &pipeline,
        ColorAdjustment {
            temperature: 100.0,
            ..neutral
        },
    );
    let cool = render(
        &context,
        &pipeline,
        ColorAdjustment {
            temperature: -100.0,
            ..neutral
        },
    );
    assert!(warm[0] > cool[0] && warm[2] < cool[2]);
    let tint = render(
        &context,
        &pipeline,
        ColorAdjustment {
            tint: 100.0,
            ..neutral
        },
    );
    assert!(tint[1] < base[1]);
    for pixel in [mono, exposed, contrast, warm, cool, tint] {
        assert_eq!(pixel[3], 128);
    }
}

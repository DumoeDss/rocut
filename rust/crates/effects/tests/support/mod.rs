use effects::{ApplyEffectsOptions, EffectPass, EffectPipeline};
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
pub fn block_on<F: Future>(future: F) -> F::Output {
    let waker = Waker::from(Arc::new(ThreadWake(std::thread::current())));
    let mut cx = Context::from_waker(&waker);
    let mut future = pin!(future);
    let deadline = std::time::Instant::now() + Duration::from_secs(30);
    loop {
        if let Poll::Ready(value) = future.as_mut().poll(&mut cx) {
            return value;
        }
        assert!(std::time::Instant::now() < deadline, "GPU timeout");
        std::thread::park_timeout(Duration::from_millis(10));
    }
}

pub fn render(
    context: &GpuContext,
    pipeline: &EffectPipeline,
    input: &[u8],
    width: u32,
    height: u32,
    passes: &[EffectPass],
) -> Vec<u8> {
    let bgra = context.texture_format() == wgpu::TextureFormat::Bgra8Unorm;
    let mut bytes = input.to_vec();
    if bgra {
        for pixel in bytes.chunks_exact_mut(4) {
            pixel.swap(0, 2);
        }
    }
    let source = context.create_render_texture(width, height, "stylized-source");
    context.queue().write_texture(
        source.as_image_copy(),
        &bytes,
        wgpu::TexelCopyBufferLayout {
            offset: 0,
            bytes_per_row: Some(width * 4),
            rows_per_image: Some(height),
        },
        wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
    );
    let output = pipeline
        .apply(
            context,
            ApplyEffectsOptions {
                source: &source,
                width,
                height,
                passes,
            },
        )
        .unwrap();
    let stride = (width * 4).div_ceil(256) * 256;
    let buffer = context.device().create_buffer(&wgpu::BufferDescriptor {
        label: Some("stylized-readback"),
        size: u64::from(stride * height),
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
                bytes_per_row: Some(stride),
                rows_per_image: Some(height),
            },
        },
        wgpu::Extent3d {
            width,
            height,
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
    let data = buffer.slice(..).get_mapped_range();
    let mut rgba = Vec::with_capacity(input.len());
    for row in data.chunks_exact(stride as usize) {
        rgba.extend_from_slice(&row[..width as usize * 4]);
    }
    drop(data);
    buffer.unmap();
    if bgra {
        for pixel in rgba.chunks_exact_mut(4) {
            pixel.swap(0, 2);
        }
    }
    rgba
}

use std::{
    future::Future,
    pin::pin,
    sync::Arc,
    task::{Context, Poll, Wake, Waker},
    time::{Duration, Instant},
};

use crate::{GpuContext, surface_presentation::SurfacePresentation};

struct ThreadWake(std::thread::Thread);
impl Wake for ThreadWake {
    fn wake(self: Arc<Self>) {
        self.0.unpark();
    }
}

fn block_on<F: Future>(future: F) -> F::Output {
    let waker = Waker::from(Arc::new(ThreadWake(std::thread::current())));
    let mut context = Context::from_waker(&waker);
    let mut future = pin!(future);
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        if let Poll::Ready(value) = future.as_mut().poll(&mut context) {
            return value;
        }
        assert!(
            Instant::now() < deadline,
            "surface presentation GPU timeout"
        );
        std::thread::park_timeout(Duration::from_millis(10));
    }
}

fn render(context: &GpuContext, input: &[u8], premultiply: bool) -> Vec<u8> {
    let width = input.len() as u32 / 4;
    let bgra = context.texture_format() == wgpu::TextureFormat::Bgra8Unorm;
    let mut upload = input.to_vec();
    if bgra {
        for pixel in upload.chunks_exact_mut(4) {
            pixel.swap(0, 2);
        }
    }
    let source = context.create_render_texture(width, 1, "surface-regression-source");
    let output = context.create_render_texture(width, 1, "surface-regression-output");
    let size = wgpu::Extent3d {
        width,
        height: 1,
        depth_or_array_layers: 1,
    };
    context.queue().write_texture(
        source.as_image_copy(),
        &upload,
        wgpu::TexelCopyBufferLayout {
            offset: 0,
            bytes_per_row: Some(width * 4),
            rows_per_image: Some(1),
        },
        size,
    );
    let mut encoder = context
        .device()
        .create_command_encoder(&wgpu::CommandEncoderDescriptor::default());
    let presentation = SurfacePresentation::new(
        context.device(),
        context.texture_sampler_bind_group_layout(),
        context.texture_format(),
    );
    presentation.encode(
        context,
        &mut encoder,
        &source,
        &output.create_view(&wgpu::TextureViewDescriptor::default()),
        premultiply,
        "surface-regression-pass",
    );
    let buffer = context.device().create_buffer(&wgpu::BufferDescriptor {
        label: Some("surface-regression-readback"),
        size: 256,
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });
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
        size,
    );
    context.queue().submit([encoder.finish()]);
    let (send, receive) = std::sync::mpsc::channel();
    buffer
        .slice(..)
        .map_async(wgpu::MapMode::Read, move |result| {
            send.send(result).unwrap();
        });
    context
        .device()
        .poll(wgpu::PollType::Wait {
            submission_index: None,
            timeout: Some(Duration::from_secs(10)),
        })
        .unwrap();
    receive
        .recv_timeout(Duration::from_secs(10))
        .unwrap()
        .unwrap();
    let data = buffer.slice(..).get_mapped_range();
    let mut result = data[..input.len()].to_vec();
    drop(data);
    buffer.unmap();
    if bgra {
        for pixel in result.chunks_exact_mut(4) {
            pixel.swap(0, 2);
        }
    }
    result
}

#[test]
#[ignore = "requires native GPU; verifies pixel conversion, not browser surface capability"]
fn presentation_converts_once_and_internal_blit_preserves_straight_hidden_rgb() {
    let context = block_on(GpuContext::new()).unwrap();
    // Includes the observed Liquid edge (blue=32, alpha=169), hidden RGB,
    // one-unorm coverage, partial coverage, and an exact opaque control.
    let source = [
        255, 0, 255, 0, 50, 150, 250, 1, 64, 128, 192, 96, 0, 1, 32, 169, 22, 66, 99, 255,
    ];
    let straight = render(&context, &source, false);
    assert_eq!(
        straight, source,
        "PostMultiplied/internal blit must not premultiply"
    );
    let presented = render(&context, &source, true);
    for (pixel, (actual, original)) in presented
        .chunks_exact(4)
        .zip(source.chunks_exact(4))
        .enumerate()
    {
        assert_eq!(actual[3], original[3], "alpha at pixel {pixel}");
        for channel in 0..3 {
            let expected =
                (f64::from(original[channel]) * f64::from(original[3]) / 255.0).round() as u8;
            assert!(
                actual[channel].abs_diff(expected) <= 1,
                "pixel {pixel} channel {channel}: {} vs {expected}",
                actual[channel]
            );
        }
    }
    assert_eq!(
        &presented[..4],
        &[0, 0, 0, 0],
        "hidden RGB disappears only at presentation"
    );
    assert_eq!(
        &presented[16..],
        &source[16..],
        "opaque pixels remain exact"
    );
}

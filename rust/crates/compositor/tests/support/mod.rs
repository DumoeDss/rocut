use gpu::{GpuContext, wgpu};
use std::{
    future::Future,
    pin::pin,
    sync::Arc,
    task::{Context, Poll, Wake, Waker},
    time::Duration,
};

// Some Windows adapters cannot acquire multiple test devices concurrently.
static GPU_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
pub fn lock_gpu() -> std::sync::MutexGuard<'static, ()> {
    GPU_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

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
pub fn context() -> GpuContext {
    let context = block_on(GpuContext::new()).expect("native GPU unavailable");
    eprintln!("GPU backend: {:?}", context.adapter().get_info().backend);
    context
}
pub fn texture(context: &GpuContext, rgba: [u8; 4]) -> wgpu::Texture {
    let source = context.create_render_texture(1, 1, "compositor-test-source");
    let bytes = if context.texture_format() == wgpu::TextureFormat::Bgra8Unorm {
        [rgba[2], rgba[1], rgba[0], rgba[3]]
    } else {
        rgba
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
    source
}
pub fn read_pixel(context: &GpuContext, output: &wgpu::Texture) -> [u8; 4] {
    let buffer = context.device().create_buffer(&wgpu::BufferDescriptor {
        label: Some("compositor-test-readback"),
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
    let rgba = if context.texture_format() == wgpu::TextureFormat::Bgra8Unorm {
        [bytes[2], bytes[1], bytes[0], bytes[3]]
    } else {
        [bytes[0], bytes[1], bytes[2], bytes[3]]
    };
    drop(bytes);
    buffer.unmap();
    rgba
}
pub fn assert_pixel(actual: [u8; 4], expected: [u8; 4]) {
    assert!(
        actual.iter().zip(expected).all(|(a, b)| a.abs_diff(b) <= 2),
        "pixel {actual:?} != {expected:?}"
    );
}

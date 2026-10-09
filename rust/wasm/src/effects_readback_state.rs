use std::{cell::Cell, task::Waker};

// Per staging buffer; the RGBA copy and returned canvas have separate allocations.
const MAX_READBACK_BYTES: u64 = 64 * 1024 * 1024;
const TIMEOUT_MS: f64 = 10_000.0;
const MAX_POLLS: u32 = 2_500;

pub(crate) struct ReadbackProgress {
    deadline: f64,
    polls: u32,
}

impl ReadbackProgress {
    pub(crate) fn new(now: f64) -> Result<Self, &'static str> {
        let deadline = now + TIMEOUT_MS;
        if !now.is_finite() || !deadline.is_finite() {
            return Err("Readback clock is not finite.");
        }
        Ok(Self { deadline, polls: 0 })
    }

    pub(crate) fn check(&self, now: f64) -> Result<(), &'static str> {
        if !now.is_finite() || now >= self.deadline || self.polls >= MAX_POLLS {
            Err("Diagnostic GPU readback timed out.")
        } else {
            Ok(())
        }
    }

    pub(crate) fn should_poll(&mut self, timer_ready: bool) -> bool {
        if self.polls == 0 || timer_ready {
            self.polls += 1;
            true
        } else {
            false
        }
    }
}

thread_local! {
    static ACTIVE: Cell<bool> = const { Cell::new(false) };
}

pub(crate) struct ReadbackGuard;

impl ReadbackGuard {
    pub(crate) fn acquire() -> Result<Self, &'static str> {
        ACTIVE.with(|active| {
            if active.replace(true) {
                Err("Only one diagnostic readback may be pending.")
            } else {
                Ok(Self)
            }
        })
    }

    pub(crate) fn is_active() -> bool {
        ACTIVE.with(Cell::get)
    }
}

impl Drop for ReadbackGuard {
    fn drop(&mut self) {
        ACTIVE.with(|active| active.set(false));
    }
}

#[derive(Debug)]
pub(crate) struct ReadbackLayout {
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) stride: u32,
    pub(crate) buffer_size: u64,
    row_bytes: usize,
    rgba_size: usize,
}

impl ReadbackLayout {
    pub(crate) fn new(
        width: u32,
        height: u32,
        max_dimension: u32,
        max_buffer_size: u64,
    ) -> Result<Self, &'static str> {
        if width == 0 || height == 0 || width > max_dimension || height > max_dimension {
            return Err("Diagnostic dimensions must be nonzero and within GPU limits.");
        }
        let row_bytes = width.checked_mul(4).ok_or("Readback row size overflow.")?;
        let stride = row_bytes
            .checked_add(255)
            .map(|value| value / 256 * 256)
            .ok_or("Readback padded row size overflow.")?;
        let buffer_size = u64::from(stride)
            .checked_mul(u64::from(height))
            .ok_or("Readback buffer size overflow.")?;
        if buffer_size > max_buffer_size.min(MAX_READBACK_BYTES) {
            return Err("Diagnostic readback exceeds its allocation limit.");
        }
        let rgba_size = usize::try_from(u64::from(row_bytes) * u64::from(height))
            .map_err(|_| "Readback output size overflow.")?;
        Ok(Self {
            width,
            height,
            stride,
            buffer_size,
            row_bytes: row_bytes as usize,
            rgba_size,
        })
    }

    pub(crate) fn unpack(&self, data: &[u8], bgra: bool) -> Result<Vec<u8>, &'static str> {
        if data.len() as u64 != self.buffer_size {
            return Err("Mapped readback length does not match the copy layout.");
        }
        let mut rgba = Vec::new();
        rgba.try_reserve_exact(self.rgba_size)
            .map_err(|_| "Cannot allocate diagnostic RGBA output.")?;
        for row in data.chunks_exact(self.stride as usize) {
            rgba.extend_from_slice(&row[..self.row_bytes]);
        }
        if bgra {
            for pixel in rgba.chunks_exact_mut(4) {
                pixel.swap(0, 2);
            }
        }
        Ok(rgba)
    }
}

#[derive(Default)]
pub(crate) struct MapState {
    pub(crate) result: Option<Result<(), String>>,
    pub(crate) waker: Option<Waker>,
    pub(crate) timer_ready: bool,
    closed: bool,
}

impl MapState {
    pub(crate) fn settle(&mut self, result: Result<(), String>) -> Option<Waker> {
        if self.closed || self.result.is_some() {
            return None;
        }
        self.result = Some(result);
        self.waker.take()
    }

    pub(crate) fn tick(&mut self) -> Option<Waker> {
        if self.closed {
            return None;
        }
        self.timer_ready = true;
        self.waker.take()
    }

    pub(crate) fn close(&mut self) {
        self.closed = true;
        self.result = None;
        self.waker = None;
        self.timer_ready = false;
    }
}

#[cfg(test)]
#[path = "effects_readback_tests.rs"]
mod tests;

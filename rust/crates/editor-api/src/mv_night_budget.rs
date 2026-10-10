//! Reservations include stated provider copies, not measured process residency.
use super::transport;
use std::sync::Mutex;
#[derive(Default)]
struct Global {
    owners: u32,
    bytes: u64,
}
static GLOBAL: Mutex<Global> = Mutex::new(Global {
    owners: 0,
    bytes: 0,
});
pub(super) struct OwnerLease;
impl OwnerLease {
    pub fn new() -> Result<Self, String> {
        let mut global = GLOBAL.lock().map_err(|_| "Night budget poisoned")?;
        if global.owners >= 8 {
            return Err("Night live owner count exhausted".into());
        }
        global.owners += 1;
        Ok(Self)
    }
}
impl Drop for OwnerLease {
    fn drop(&mut self) {
        if let Ok(mut global) = GLOBAL.lock() {
            global.owners = global.owners.saturating_sub(1);
        }
    }
}
pub(super) struct Reservation(pub u64);
impl Reservation {
    pub fn new(bytes: u64) -> Result<Self, String> {
        let mut global = GLOBAL.lock().map_err(|_| "Night budget poisoned")?;
        global.bytes = transport::sum(global.bytes, bytes, transport::MAX_GLOBAL_BYTES)?;
        Ok(Self(bytes))
    }
}
impl Drop for Reservation {
    fn drop(&mut self) {
        if let Ok(mut global) = GLOBAL.lock() {
            global.bytes = global.bytes.saturating_sub(self.0);
        }
    }
}

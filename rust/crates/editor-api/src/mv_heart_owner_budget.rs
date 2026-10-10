// Private lexical leaf of the transient owner capability.
pub const MAX_OWNER_BYTES: u64 = 256 * 1024 * 1024;
pub const MAX_GLOBAL_BYTES: u64 = 256 * 1024 * 1024;
pub const MAX_OWNERS: u32 = 8;
pub const MAX_OWNER_SESSIONS: usize = 4;
pub const MAX_GLOBAL_SESSIONS: u32 = 16;
const MAX_INPUT_JSON: usize = 64 * 1024;
const MAX_OUTPUT_JSON: usize = 16 * 1024 * 1024;
const METADATA_RESERVATION: u64 = 64 * 1024;
// Full validated bindings repeated in image records plus temporary manifest
// clones/serialization and provider metadata copies. Reserved before preparation.
const IMAGE_METADATA_RESERVATION: u64 = 16 * 1024;
const DECODER: &str = "canvas2d-srgb-unpremultiplied-rgba8-v1";

struct Global {
    next_owner: u32,
    owners: u32,
    sessions: u32,
    bytes: u64,
}
static GLOBAL: Mutex<Global> = Mutex::new(Global {
    next_owner: 1,
    owners: 0,
    sessions: 0,
    bytes: 0,
});
fn global() -> Result<std::sync::MutexGuard<'static, Global>, String> {
    GLOBAL
        .lock()
        .map_err(|_| "Heart owner budget lock poisoned".into())
}
struct Reservation {
    bytes: u64,
    active: bool,
}
impl Reservation {
    fn new(bytes: u64) -> Result<Self, String> {
        let mut state = global()?;
        let total = state
            .bytes
            .checked_add(bytes)
            .ok_or("Heart global reservation overflow")?;
        if total > MAX_GLOBAL_BYTES || state.sessions >= MAX_GLOBAL_SESSIONS {
            return Err("Heart global session/reservation capability exhausted".into());
        }
        state.bytes = total;
        state.sessions += 1;
        Ok(Self {
            bytes,
            active: true,
        })
    }
    fn transfer(&mut self) {
        self.active = false;
    }
}
impl Drop for Reservation {
    fn drop(&mut self) {
        if self.active {
            if let Ok(mut state) = global() {
                state.bytes -= self.bytes;
                state.sessions -= 1;
            }
        }
    }
}

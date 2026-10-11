//! Owner-only, non-serializable single-flight native preparation capabilities.
use super::{Session, plan};
use std::sync::atomic::{AtomicU64, Ordering};
fn scratch_bytes(commands: &[plan::Command], count: &mut usize) -> Result<u64, String> {
    let mut bytes = 0u64;
    for command in commands {
        *count += 1;
        if *count > 8192 {
            return Err("Memories stage command graph exceeds limits".into());
        }
        if let plan::Command::Memories(plan::MemoryCommand::Surface { size, commands, .. }) =
            command
        {
            if size.iter().any(|v| !(1..=4096).contains(v)) {
                return Err("Memories stage surface exceeds limits".into());
            }
            // Conservatively hold every scratch for the entire stage, including
            // filter scratch double-buffer; releases can only reduce residency.
            bytes = bytes
                .checked_add(size[0] as u64 * size[1] as u64 * 24)
                .ok_or("Memories stage scratch overflow")?;
            bytes = bytes
                .checked_add(scratch_bytes(commands, count)?)
                .ok_or("Memories stage scratch overflow")?;
        }
    }
    Ok(bytes)
}
static NEXT_OWNER: AtomicU64 = AtomicU64::new(1);
#[derive(Clone, Copy, PartialEq, Debug)]
pub(super) enum Kind {
    Lut,
    Composite(usize),
    Print(usize),
    Desk,
}
/// Cannot be authored, cloned or deserialized; consume with the same Session.
pub struct Readback {
    owner: u64,
    serial: u64,
    kind: Kind,
    size: [u32; 2],
    plan_sha256: String,
}
impl Readback {
    pub fn dimensions(&self) -> [u32; 2] {
        self.size
    }
    pub fn plan_sha256(&self) -> &str {
        &self.plan_sha256
    }
}
pub struct Stage {
    pub plan: plan::Plan,
    pub payloads: Vec<plan::Payload>,
    pub readback: Readback,
}
pub(super) struct State {
    owner: u64,
    serial: u64,
    pending: Option<(u64, Kind, [u32; 2])>,
    pub limit: u64,
    pub reserved: u64,
    pub lut: Option<Vec<u8>>,
}
impl State {
    pub fn new(limit: u64, reserved: u64) -> Result<Self, String> {
        let owner = NEXT_OWNER
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |n| n.checked_add(1))
            .map_err(|_| "Memories owner identity exhausted")?;
        Ok(Self {
            owner,
            serial: 0,
            pending: None,
            limit,
            reserved,
            lut: None,
        })
    }
    pub fn idle(&self) -> Result<(), String> {
        if self.pending.is_some() {
            Err("Memories native readback is already pending".into())
        } else {
            Ok(())
        }
    }
    pub fn verify(&self, token: &Readback, kind: Kind, bytes: usize) -> Result<(), String> {
        if token.owner != self.owner
            || token.kind != kind
            || self.pending != Some((token.serial, kind, token.size))
            || bytes != token.size[0] as usize * token.size[1] as usize * 4
        {
            return Err("Memories readback capability, sequence or dimensions mismatch".into());
        }
        Ok(())
    }
    pub fn consume(&mut self) {
        self.pending = None;
    }
    pub fn begin(
        &mut self,
        kind: Kind,
        size: [u32; 2],
        mut plan: plan::Plan,
        payloads: Vec<plan::Payload>,
    ) -> Result<Stage, String> {
        self.idle()?;
        // Reserve simultaneously: native target/filter double-buffer, readback,
        // transport/WASM copies, grade output, plus all admitted source/retained art.
        let mut total = self
            .reserved
            .checked_add(size[0] as u64 * size[1] as u64 * 4 * 10)
            .ok_or("Memories stage residency overflow")?;
        total = total
            .checked_add(scratch_bytes(&plan.commands, &mut 0)?)
            .ok_or("Memories stage scratch overflow")?;
        for p in &payloads {
            total = total
                .checked_add(p.rgba.capacity() as u64 * 3)
                .ok_or("Memories stage payload overflow")?;
        }
        let json = serde_json::to_vec(&plan).map_err(|e| e.to_string())?;
        if json.len() > 16 * 1024 * 1024 {
            return Err("Memories stage plan exceeds limits".into());
        }
        total = total
            .checked_add(json.len() as u64 * 12 + 2 * 1024 * 1024)
            .ok_or("Memories stage JSON overflow")?;
        if total > self.limit {
            return Err("Memories joint native stage exceeds admission ceiling".into());
        }
        plan.raster_budget_bytes = total;
        use sha2::{Digest, Sha256};
        let plan_sha256 = format!(
            "{:x}",
            Sha256::digest(serde_json::to_vec(&plan).map_err(|e| e.to_string())?)
        );
        self.serial = self
            .serial
            .checked_add(1)
            .ok_or("Memories stage identity exhausted")?;
        self.pending = Some((self.serial, kind, size));
        Ok(Stage {
            plan,
            payloads,
            readback: Readback {
                owner: self.owner,
                serial: self.serial,
                kind,
                size,
                plan_sha256,
            },
        })
    }
}
impl Session {
    /// Cancelling consumes the current capability without admitting any pixels.
    pub fn cancel_stage(&mut self, readback: Readback) -> Result<(), String> {
        self.stage.verify(
            &readback,
            readback.kind,
            readback.size[0] as usize * readback.size[1] as usize * 4,
        )?;
        self.stage.consume();
        Ok(())
    }
    pub fn lut_plan(&mut self) -> Result<Stage, String> {
        if self.stage.lut.is_some() {
            return Err("Memories local LUT already admitted".into());
        }
        self.stage
            .begin(Kind::Lut, [256, 1], super::bake::lut(), vec![])
    }
    pub fn accept_lut(&mut self, readback: Readback, rgba: &[u8]) -> Result<(), String> {
        self.stage.verify(&readback, Kind::Lut, rgba.len())?;
        self.stage.lut = Some(rgba.to_vec());
        self.stage.consume();
        Ok(())
    }
    pub fn composite_plan(&mut self, slot: usize) -> Result<Stage, String> {
        self.stage.idle()?;
        let photo = self.photos.get(slot).ok_or("Memories photo slot missing")?;
        if self.stage.lut.is_none() || photo.graded.is_some() || photo.base.is_some() {
            return Err("Memories composite stage is out of order".into());
        }
        let plan = super::bake::composite(self, slot)?;
        self.stage
            .begin(Kind::Composite(slot), [1040, 650], plan, vec![])
    }
    pub fn accept_composite(
        &mut self,
        slot: usize,
        readback: Readback,
        rgba: &[u8],
    ) -> Result<plan::Payload, String> {
        self.stage
            .verify(&readback, Kind::Composite(slot), rgba.len())?;
        let lut: Vec<u8> = self
            .stage
            .lut
            .as_ref()
            .ok_or("Memories local LUT missing")?
            .chunks_exact(4)
            .flat_map(|p| p[..3].iter().copied())
            .collect();
        let p = self
            .photos
            .get_mut(slot)
            .ok_or("Memories preparation slot missing")?;
        let payload = plan::raster(
            &self.binding,
            format!("photo-{slot}-graded"),
            [1040, 650],
            super::grade::grade(rgba, &lut, p.seed).map_err(str::to_owned)?,
        )?;
        p.graded = Some(payload.raster.clone());
        self.stage.consume();
        Ok(payload)
    }
    pub fn print_plan(&mut self, slot: usize) -> Result<Stage, String> {
        self.stage.idle()?;
        if self
            .photos
            .get(slot)
            .ok_or("Memories photo slot missing")?
            .base
            .is_some()
        {
            return Err("Memories print already admitted".into());
        }
        let plan = super::paper::print(self, slot)?;
        self.stage
            .begin(Kind::Print(slot), [1120, 862], plan, vec![])
    }
    pub fn accept_print(
        &mut self,
        slot: usize,
        readback: Readback,
        rgba: &[u8],
    ) -> Result<plan::Raster, String> {
        self.stage
            .verify(&readback, Kind::Print(slot), rgba.len())?;
        let p = self
            .photos
            .get_mut(slot)
            .ok_or("Memories preparation slot missing")?;
        p.base = Some(plan::raster(
            &self.binding,
            format!("photo-{slot}-base"),
            [1120, 862],
            super::grade::tooth(rgba, p.seed).map_err(str::to_owned)?,
        )?);
        let retired = p
            .graded
            .take()
            .ok_or("Memories graded composite is not admitted")?;
        self.stage.consume();
        Ok(retired)
    }
    pub fn desk_plan(&mut self) -> Result<Stage, String> {
        self.stage.idle()?;
        if self.desk.is_some() {
            return Err("Memories desk already admitted".into());
        }
        let (plan, payload) = super::bake::desk(self)?;
        self.stage
            .begin(Kind::Desk, [1200, 675], plan, vec![payload])
    }
    pub fn accept_desk(&mut self, readback: Readback, rgba: &[u8]) -> Result<(), String> {
        self.stage.verify(&readback, Kind::Desk, rgba.len())?;
        self.desk = Some(plan::raster(
            &self.binding,
            "desk".into(),
            [1200, 675],
            super::grade::desk_grain(rgba, self.args.seed.unwrap_or(45) as f64)
                .map_err(str::to_owned)?,
        )?);
        self.stage.consume();
        Ok(())
    }
}

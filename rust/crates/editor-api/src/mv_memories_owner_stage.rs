use super::*;
/// No Clone/Deserialize and no JSON handle lookup. Lease survives session cancel.
pub struct Output {
    pub(super) identity: Identity,
    pub(super) serial: u32,
    json: String,
    plan_json: String,
    payloads: Vec<Option<memories::plan::Payload>>,
    _lease: Arc<Lease>,
}
impl Output {
    pub(super) fn new(
        identity: Identity,
        serial: u32,
        plan: memories::plan::Plan,
        payloads: Vec<memories::plan::Payload>,
        lease: Arc<Lease>,
    ) -> Result<Self, String> {
        let rasters: Vec<_> = payloads.iter().map(|p| &p.raster).collect();
        let plan_json = json(&plan)?;
        let json = json(&serde_json::json!({"identity":identity,"plan":plan,"rasters":rasters}))?;
        Ok(Self {
            identity,
            serial,
            json,
            plan_json,
            payloads: payloads.into_iter().map(Some).collect(),
            _lease: lease,
        })
    }
    pub fn json(&self) -> &str {
        &self.json
    }
    pub fn remaining(&self) -> usize {
        self.payloads.iter().filter(|p| p.is_some()).count()
    }
    pub fn bytes<T>(
        &mut self,
        index: usize,
        copy: impl FnOnce(&[u8]) -> Result<T, String>,
    ) -> Result<T, String> {
        let p = self
            .payloads
            .get_mut(index)
            .ok_or("Memories publication index missing")?;
        let value = p
            .as_ref()
            .ok_or("Memories publication extraction already consumed")?;
        if hash(&value.rgba) != value.raster.rgba_sha256 {
            return Err("Memories publication RGBA digest mismatch".into());
        }
        let out = copy(&value.rgba)?;
        *p = None;
        Ok(out)
    }
}
#[derive(Clone, Copy)]
enum Kind {
    Lut,
    Composite(usize),
    Print(usize),
    Desk,
}
pub struct Stage {
    output: Output,
    token: memories::stage::Readback,
    kind: Kind,
}
impl Stage {
    pub fn json(&self) -> Result<String, String> {
        let output: serde_json::Value =
            serde_json::from_str(self.output.json()).map_err(|e| e.to_string())?;
        json(
            &serde_json::json!({"output":output,"planJson":self.output.plan_json,"size":self.token.dimensions(),"planSha256":self.token.plan_sha256()}),
        )
    }
    pub fn bytes<T>(
        &mut self,
        index: usize,
        copy: impl FnOnce(&[u8]) -> Result<T, String>,
    ) -> Result<T, String> {
        self.output.bytes(index, copy)
    }
}
impl Owner {
    pub fn begin_stage(&mut self, id: u32, kind: &str, slot: usize) -> Result<Stage, String> {
        let e = self.entry(id)?;
        if e.pending_frame.is_some() {
            return Err("Memories frame publication pending".into());
        }
        let kind = match kind {
            "lut" => Kind::Lut,
            "composite" => Kind::Composite(slot),
            "print" => Kind::Print(slot),
            "desk" => Kind::Desk,
            _ => return Err("Unknown Memories stage".into()),
        };
        let stage = match kind {
            Kind::Lut => e.session.lut_plan()?,
            Kind::Composite(i) => e.session.composite_plan(i)?,
            Kind::Print(i) => e.session.print_plan(i)?,
            Kind::Desk => e.session.desk_plan()?,
        };
        let output = Output::new(e.identity, 0, stage.plan, stage.payloads, e.lease.clone())?;
        Ok(Stage {
            output,
            token: stage.readback,
            kind,
        })
    }
    pub fn accept_stage_with<T: AsRef<[u8]>>(
        &mut self,
        id: u32,
        stage: Stage,
        input: &str,
        length: usize,
        copy: impl FnOnce() -> Result<T, String>,
    ) -> Result<Option<Output>, String> {
        let e = self.entry(id)?;
        let b: ReadbackBinding = parse(input)?;
        if stage.output.identity.owner_id != e.identity.owner_id
            || stage.output.identity.session_id != id
            || stage.output.remaining() != 0
            || b.plan_sha256 != stage.token.plan_sha256()
            || [b.width, b.height] != stage.token.dimensions()
            || b.decoder != DECODER
            || length != b.width as usize * b.height as usize * 4
        {
            return Err("Memories opaque stage/readback native binding mismatch".into());
        }
        let bytes = copy()?;
        if bytes.as_ref().len() != length || hash(bytes.as_ref()) != b.rgba_sha256 {
            return Err("Memories native readback RGBA digest mismatch".into());
        }
        let payload = match stage.kind {
            Kind::Lut => {
                e.session.accept_lut(stage.token, bytes.as_ref())?;
                None
            }
            Kind::Composite(i) => {
                Some(e.session.accept_composite(i, stage.token, bytes.as_ref())?)
            }
            Kind::Print(i) => {
                let retired = e.session.accept_print(i, stage.token, bytes.as_ref())?;
                return Ok(Some(
                    Output::new(
                        e.identity,
                        0,
                        memories::plan::Plan {
                            commands: vec![],
                            raster_budget_bytes: 0,
                        },
                        vec![],
                        e.lease.clone(),
                    )?
                    .with_retired(retired)?,
                ));
            }
            Kind::Desk => {
                e.session.accept_desk(stage.token, bytes.as_ref())?;
                None
            }
        };
        payload
            .map(|p| {
                Output::new(
                    e.identity,
                    0,
                    memories::plan::Plan {
                        commands: vec![],
                        raster_budget_bytes: 0,
                    },
                    vec![p],
                    e.lease.clone(),
                )
            })
            .transpose()
    }
    pub fn cancel_stage(&mut self, id: u32, stage: Stage) -> Result<(), String> {
        let e = self.entry(id)?;
        if stage.output.identity.owner_id != e.identity.owner_id
            || stage.output.identity.session_id != id
        {
            return Err("Memories stage belongs to another session".into());
        }
        e.session.cancel_stage(stage.token)
    }
}
impl Output {
    fn with_retired(mut self, raster: memories::plan::Raster) -> Result<Self, String> {
        let mut data: serde_json::Value =
            serde_json::from_str(&self.json).map_err(|e| e.to_string())?;
        data["retired"] = serde_json::to_value(raster).map_err(|e| e.to_string())?;
        self.json = json(&data)?;
        Ok(self)
    }
}

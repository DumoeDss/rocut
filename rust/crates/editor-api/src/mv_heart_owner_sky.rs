// Sky has a distinct retained producer and plan transport; it has no Heart crops.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SkyPrepareInput {
    source: Resource,
    binding: BackgroundBinding,
    character: BackgroundBinding,
    settings: heart::SkyShatter,
    ceiling_bytes: u64,
    encoded_layout: Layout,
    decoded_layout: Layout,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SkyIdentity {
    owner_id: u32,
    session_id: u32,
    binding: BackgroundBinding,
    character: BackgroundBinding,
    settings: heart::SkyShatter,
    images_manifest_sha256: String,
}
struct SkyEntry {
    session: heart::SkySession,
    identity: SkyIdentity,
    reserved_bytes: u64,
    frame_extra: u64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SkyManifest<'a> {
    kind: &'static str,
    identity: &'a SkyIdentity,
    images: [Image; 0],
    reserved_bytes: u64,
}
#[derive(Serialize)]
struct SkyFrame<'a> {
    kind: &'static str,
    identity: &'a SkyIdentity,
    plan: heart::SkyPlan,
}
impl Owner {
    pub fn prepare_sky_with<E: AsRef<[u8]>, D: AsRef<[u8]>>(
        &mut self,
        metadata_json: &str,
        encoded_len: usize,
        decoded_len: usize,
        copy: impl FnOnce() -> Result<(E, D), String>,
    ) -> Result<u32, String> {
        self.check()?;
        let input: SkyPrepareInput = parse(metadata_json)?;
        if input.ceiling_bytes == 0
            || input.ceiling_bytes > MAX_OWNER_BYTES
            || self.entries.len() + self.sky_entries.len() >= MAX_OWNER_SESSIONS
        {
            return Err("Sky session ceiling/capability exceeded".into());
        }
        if input.source != input.binding.source
            || input.settings.bg != input.source.id
            || input.settings.char != input.character.source.id
        {
            return Err("Sky source/character/settings identity mismatch".into());
        }
        let resources = [input.source.clone(), input.character.source.clone()];
        if let Some(issue) = crate::programmatic_resources::validate(&resources).first() {
            return Err(issue.message.clone());
        }
        input.encoded_layout.validate(encoded_len, false)?;
        input.decoded_layout.validate(decoded_len, false)?;
        if encoded_len > 32 * 1024 * 1024 || decoded_len > 128 * 1024 * 1024 {
            return Err("Sky binary packet exceeds hard limits".into());
        }
        let source_charge = native_metadata(
            &input.binding,
            &Some(Range {
                offset: 0,
                length: input.encoded_layout.source.length,
            }),
            &Some(Range {
                offset: 0,
                length: input.decoded_layout.source.length,
            }),
        )?;
        let character_charge = native_metadata(
            &input.character,
            &input.encoded_layout.character,
            &input.decoded_layout.character,
        )?;
        let frame_extra = (encoded_len as u64)
            .checked_add(decoded_len as u64)
            .and_then(|v| v.checked_mul(2))
            .and_then(|v| v.checked_add(METADATA_RESERVATION))
            .ok_or("Sky binary copy reservation overflow")?;
        let preparation_extra = frame_extra
            .checked_add(character_charge)
            .ok_or("Sky preparation budget overflow")?;
        let preparation_ceiling = input
            .ceiling_bytes
            .checked_sub(preparation_extra)
            .ok_or("Sky joint preparation ceiling exceeded")?;
        // Mirror the producer's allocation-free admission before the WASM copy.
        if source_charge
            .checked_add(98 * 1024 * 1024)
            .ok_or("Sky preparation budget overflow")?
            > preparation_ceiling
        {
            return Err("Sky preparation exceeds admission ceiling".into());
        }
        let local = self
            .reserved_bytes
            .checked_add(input.ceiling_bytes)
            .ok_or("Sky owner reservation overflow")?;
        if local > MAX_OWNER_BYTES {
            return Err("Sky owner aggregate ceiling exceeded".into());
        }
        let id = self.next_session;
        self.next_session = id.checked_add(1).ok_or("Sky session identity exhausted")?;
        let mut reservation = Reservation::new(input.ceiling_bytes)?;
        let (encoded_packet, decoded_packet) = copy()?;
        let (encoded_packet, decoded_packet) = (encoded_packet.as_ref(), decoded_packet.as_ref());
        if encoded_packet.len() != encoded_len || decoded_packet.len() != decoded_len {
            return Err("Sky binary input changed while copying".into());
        }
        let (source_encoded, _) = input.encoded_layout.split(encoded_packet, false)?;
        let (source_rgba, _) = input.decoded_layout.split(decoded_packet, false)?;
        background(&input.binding, source_encoded, source_rgba)?;
        background(
            &input.character,
            character_bytes(&input.encoded_layout, encoded_packet)?
                .ok_or("Sky character encoded bytes missing")?,
            character_bytes(&input.decoded_layout, decoded_packet)?
                .ok_or("Sky character decoded bytes missing")?,
        )?;
        let session = heart::SkySession::prepare(
            input.source,
            input.binding.decoded_width,
            input.binding.decoded_height,
            input.settings.seed.unwrap_or(3913),
            input.settings.impact.unwrap_or([1150.0, 300.0]),
            input.settings.night.as_deref().unwrap_or("#070b1c"),
            preparation_ceiling as usize,
        )?;
        let identity = SkyIdentity {
            owner_id: self.id,
            session_id: id,
            binding: input.binding,
            character: input.character,
            settings: input.settings,
            images_manifest_sha256: hash(b"[]"),
        };
        let entry = SkyEntry {
            session,
            identity,
            reserved_bytes: input.ceiling_bytes,
            frame_extra,
        };
        Self::sky_manifest(&entry)?;
        self.sky_entries.insert(id, entry);
        self.reserved_bytes = local;
        reservation.transfer();
        Ok(id)
    }
    fn sky_manifest(entry: &SkyEntry) -> Result<String, String> {
        json(&SkyManifest {
            kind: "skyShatter",
            identity: &entry.identity,
            images: [],
            reserved_bytes: entry.reserved_bytes,
        })
    }
    fn sky_manifest_json(&mut self, id: u32) -> Result<String, String> {
        let result = self.check().and_then(|_| {
            Self::sky_manifest(
                self.sky_entries
                    .get(&id)
                    .ok_or("Unknown/stale Sky session")?,
            )
        });
        if result.is_err() {
            self.cancel(id)?;
        }
        result
    }
    fn sky_frame_json(&mut self, id: u32, metadata: &str) -> Result<String, String> {
        let result = (|| {
            self.check()?;
            let entry = self
                .sky_entries
                .get(&id)
                .ok_or("Unknown/stale Sky session")?;
            let input: FrameInput = parse(metadata)?;
            let Scene::SkyShatter(settings) = input.scene else {
                return Err("Sky session requires Sky frame settings".into());
            };
            let bg = &entry.identity.binding;
            let character = &entry.identity.character;
            let resources = [bg.source.clone(), character.source.clone()];
            let sample = heart::Sample {
                shot_start_ticks: input.shot_start_ticks,
                shot_end_ticks: input.shot_end_ticks,
                song_ticks: input.song_ticks,
                beats: &input.beats,
                bpm: input.bpm,
                resources: &resources,
                background: Some(heart::BackgroundFact {
                    resource: &bg.source,
                    width: bg.decoded_width,
                    height: bg.decoded_height,
                }),
            };
            let plan = entry.session.frame(
                &settings,
                &sample,
                &heart::BackgroundFact {
                    resource: &character.source,
                    width: character.decoded_width,
                    height: character.decoded_height,
                },
            )?;
            if plan
                .raster_budget_bytes
                .checked_add(entry.frame_extra)
                .ok_or("Sky frame budget overflow")?
                > entry.reserved_bytes
            {
                return Err("Sky frame exceeds retained owner/session reservation".into());
            }
            json(&SkyFrame {
                kind: "skyShatter",
                identity: &entry.identity,
                plan,
            })
        })();
        if result.is_err() {
            self.cancel(id)?;
        }
        result
    }
}

// Private lexical leaf of the transient owner capability.
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn parse<T: serde::de::DeserializeOwned>(json: &str) -> Result<T, String> {
    if json.len() > MAX_INPUT_JSON {
        return Err("Heart owner metadata input exceeds 64 KiB".into());
    }
    serde_json::from_str(json).map_err(|e| format!("Heart owner metadata: {e}"))
}
fn json<T: Serialize>(value: &T) -> Result<String, String> {
    let output = serde_json::to_string(value).map_err(|e| e.to_string())?;
    if output.len() > MAX_OUTPUT_JSON {
        return Err("Heart owner metadata output exceeds 16 MiB".into());
    }
    Ok(output)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Range {
    offset: usize,
    length: usize,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Layout {
    source: Range,
    background: Option<Range>,
    character: Option<Range>,
}
impl Layout {
    fn validate(&self, length: usize, background: bool) -> Result<(), String> {
        if self.source.offset != 0
            || self.source.length == 0
            || self.background.is_some() != background
        {
            return Err("Heart packet layout/source/background mismatch".into());
        }
        let end = if let Some(range) = &self.background {
            if range.offset != self.source.length || range.length == 0 {
                return Err("Heart packet gap/overlap/empty background".into());
            }
            range
                .offset
                .checked_add(range.length)
                .ok_or("Heart packet range overflow")?
        } else {
            self.source.length
        };
        let end = if let Some(range) = &self.character {
            if range.offset != end || range.length == 0 {
                return Err("Heart character packet gap/overlap/empty range".into());
            }
            end.checked_add(range.length)
                .ok_or("Heart packet range overflow")?
        } else {
            end
        };
        if end != length {
            return Err("Heart packet trailing/missing bytes".into());
        }
        Ok(())
    }
    fn split<'a>(
        &self,
        bytes: &'a [u8],
        background: bool,
    ) -> Result<(&'a [u8], Option<&'a [u8]>), String> {
        if self.source.offset != 0
            || self.source.length == 0
            || self.background.is_some() != background
        {
            return Err("Heart packet layout/source/background mismatch".into());
        }
        let source = bytes
            .get(..self.source.length)
            .ok_or("Heart packet source range exceeds bytes")?;
        let end = if let Some(range) = &self.background {
            if range.offset != self.source.length || range.length == 0 {
                return Err("Heart packet gap/overlap/empty background".into());
            }
            range
                .offset
                .checked_add(range.length)
                .ok_or("Heart packet range overflow")?
        } else {
            self.source.length
        };
        self.validate(bytes.len(), background)?;
        if end > bytes.len() {
            return Err("Heart packet trailing/missing bytes".into());
        }
        Ok((
            source,
            self.background
                .as_ref()
                .map(|range| &bytes[range.offset..end]),
        ))
    }
}

#[derive(Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackgroundBinding {
    pub source: Resource,
    pub decoded_width: u32,
    pub decoded_height: u32,
    pub decoded_rgba_sha256: String,
    pub decoder: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PrepareInput {
    source: Resource,
    binding: heart::Binding,
    background: Option<BackgroundBinding>,
    character: Option<BackgroundBinding>,
    ceiling_bytes: u64,
    encoded_layout: Layout,
    decoded_layout: Layout,
}
fn metadata(input: &PrepareInput, encoded_len: usize, decoded_len: usize) -> Result<u64, String> {
    if input.source != input.binding.source {
        return Err("Heart declared source differs from native binding".into());
    }
    input
        .encoded_layout
        .validate(encoded_len, input.background.is_some())?;
    input
        .decoded_layout
        .validate(decoded_len, input.background.is_some())?;
    if encoded_len > 32 * 1024 * 1024 || decoded_len > 128 * 1024 * 1024 {
        return Err("Heart binary packet exceeds hard limits".into());
    }
    let resources: Vec<_> = std::iter::once(input.source.clone())
        .chain(input.background.as_ref().map(|b| b.source.clone()))
        .chain(input.character.as_ref().map(|b| b.source.clone()))
        .collect();
    if let Some(issue) = crate::programmatic_resources::validate(&resources).first() {
        return Err(issue.message.clone());
    }
    let valid_sha = |sha: &str| {
        sha.len() == 64
            && sha
                .bytes()
                .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
    };
    if input.source.kind != "image"
        || input.binding.decoder != DECODER
        || input.binding.algorithm != "heart-components-v1"
        || !valid_sha(&input.binding.decoded_rgba_sha256)
    {
        return Err("Heart source/native decoder/algorithm identity malformed".into());
    }
    if input.encoded_layout.source.length as u64 != input.source.byte_length()
        || input.decoded_layout.source.length as u64
            != crate::image_sequence::decoded_image_bytes(
                input.binding.decoded_width,
                input.binding.decoded_height,
            )?
    {
        return Err("Heart source packet dimensions/length mismatch".into());
    }
    let mut bg_charge = 0;
    if input.encoded_layout.character.is_some() != input.character.is_some()
        || input.decoded_layout.character.is_some() != input.character.is_some()
    {
        return Err("Heart character packet admission incomplete".into());
    }
    if let Some(character) = &input.character {
        bg_charge = native_metadata(
            character,
            &input.encoded_layout.character,
            &input.decoded_layout.character,
        )?;
    }
    if let Some(bg) = &input.background {
        let rgba = crate::image_sequence::decoded_image_bytes(bg.decoded_width, bg.decoded_height)?;
        if bg.source.kind != "image"
            || bg.source.id == input.source.id
            || bg.decoder != DECODER
            || !valid_sha(&bg.decoded_rgba_sha256)
            || input
                .encoded_layout
                .background
                .as_ref()
                .map(|r| r.length as u64)
                != Some(bg.source.byte_length())
            || input
                .decoded_layout
                .background
                .as_ref()
                .map(|r| r.length as u64)
                != Some(rgba)
        {
            return Err("Heart background native decoder/packet identity malformed".into());
        }
        bg_charge = bg_charge
            .checked_add(
                rgba.checked_mul(2)
                    .and_then(|n| n.checked_add(bg.source.byte_length()))
                    .ok_or("Heart background budget overflow")?,
            )
            .ok_or("Heart background budget overflow")?;
    }
    // Platform snapshots/readback/backing are charged by Heart admission and
    // bg_charge. The provider's immutable packet and inbound WASM copy are
    // distinct from those caller snapshots and must both remain reserved.
    bg_charge
        .checked_add(
            (encoded_len as u64)
                .checked_mul(2)
                .ok_or("Heart encoded packet budget overflow")?,
        )
        .and_then(|n| n.checked_add((decoded_len as u64).checked_mul(2)?))
        .and_then(|n| n.checked_add(METADATA_RESERVATION))
        .ok_or("Heart binary copy budget overflow".into())
}
fn native_metadata(
    binding: &BackgroundBinding,
    encoded: &Option<Range>,
    decoded: &Option<Range>,
) -> Result<u64, String> {
    let rgba =
        crate::image_sequence::decoded_image_bytes(binding.decoded_width, binding.decoded_height)?;
    if binding.source.kind != "image"
        || binding.decoder != DECODER
        || binding.decoded_rgba_sha256.len() != 64
        || !binding
            .decoded_rgba_sha256
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
        || encoded.as_ref().map(|r| r.length as u64) != Some(binding.source.byte_length())
        || decoded.as_ref().map(|r| r.length as u64) != Some(rgba)
    {
        return Err("Heart native image metadata mismatch".into());
    }
    rgba.checked_mul(2)
        .and_then(|n| n.checked_add(binding.source.byte_length()))
        .ok_or("Heart native image budget overflow".into())
}
fn character_bytes<'a>(layout: &Layout, packet: &'a [u8]) -> Result<Option<&'a [u8]>, String> {
    layout
        .character
        .as_ref()
        .map(|r| {
            packet
                .get(
                    r.offset
                        ..r.offset
                            .checked_add(r.length)
                            .ok_or("Heart packet range overflow")?,
                )
                .ok_or("Heart character range exceeds packet".into())
        })
        .transpose()
}
fn encoded(resource: &Resource, bytes: &[u8], dimensions: [u32; 2]) -> Result<(), String> {
    if let Some(issue) =
        crate::programmatic_resources::validate(std::slice::from_ref(resource)).first()
    {
        return Err(issue.message.clone());
    }
    if resource.kind != "image"
        || resource.byte_length() != bytes.len() as u64
        || resource.sha256() != hash(bytes)
    {
        return Err("Heart encoded source descriptor/length/SHA mismatch".into());
    }
    let actual = crate::image_sequence::inspect_encoded_image(resource.mime_type(), bytes)?;
    if actual != (dimensions[0], dimensions[1]) {
        return Err("Heart encoded MIME/header dimensions differ from native binding".into());
    }
    Ok(())
}
fn background(
    binding: &BackgroundBinding,
    encoded_bytes: &[u8],
    rgba: &[u8],
) -> Result<u64, String> {
    encoded(
        &binding.source,
        encoded_bytes,
        [binding.decoded_width, binding.decoded_height],
    )?;
    let length =
        crate::image_sequence::decoded_image_bytes(binding.decoded_width, binding.decoded_height)?;
    if binding.decoder != DECODER
        || length != rgba.len() as u64
        || binding.decoded_rgba_sha256 != hash(rgba)
    {
        return Err("Heart background native decoder identity mismatch".into());
    }
    // Platform encoded snapshot + platform decoded readback and native backing.
    length
        .checked_mul(2)
        .and_then(|n| n.checked_add(encoded_bytes.len() as u64))
        .ok_or("Heart background budget overflow".into())
}

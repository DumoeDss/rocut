//! Bounded owner for actual resource bytes, native decode facts and row pixels.
#[path = "mv_lut_atlas_transport.rs"]
mod transport;
use crate::{
    mv_lut_atlas::{self, DecodedImage, Plan, RowPixels, RowSample, Settings},
    programmatic_resources::{self, Resource},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
pub use transport::{
    lengths as validate_transport_lengths, row_bytes as validate_row_lengths,
    session_id as validate_session_id, MAX_METADATA_CHARS,
};
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BinaryPart {
    resource_id: String,
    offset: usize,
    length: usize,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NativeFact {
    resource_id: String,
    width: u32,
    height: u32,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Prepare {
    settings: Settings,
    resources: Vec<Resource>,
    byte_layout: Vec<BinaryPart>,
    decoded_images: Vec<NativeFact>,
    required_aliases: Vec<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Prepared {
    pub session_id: u32,
    pub plan: Value,
    pub samples: BTreeMap<String, RowSample>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoundRow {
    pub session_id: u32,
    pub alias: String,
    pub sample: RowSample,
    pub byte_length: usize,
    pub sampled_sha256: String,
}
struct Session {
    plan: Plan,
    rows: BTreeMap<String, RowPixels>,
    bytes: usize,
}
#[derive(Default)]
pub struct AtlasSessions {
    sessions: BTreeMap<u32, Session>,
    next: u32,
    resident: usize,
}
impl AtlasSessions {
    pub fn prepare(&mut self, metadata: &str, binary: &[u8]) -> Result<Prepared, String> {
        validate_transport_lengths(metadata.chars().count(), binary.len())?;
        if self.sessions.len() >= transport::MAX_PLAN_SESSIONS {
            return Err("LUT atlas owner session count exhausted".into());
        }
        let request: Prepare = serde_json::from_str(metadata)
            .map_err(|e| format!("LUT atlas invalid adapter metadata: {e}"))?;
        if request.resources.len() > 11
            || request.byte_layout.len() != request.resources.len()
            || request.decoded_images.len() != request.settings.images.len()
            || request.required_aliases.len() > 16
            || request
                .required_aliases
                .iter()
                .any(|s| s.is_empty() || s.len() > 128)
        {
            return Err("LUT atlas adapter metadata scope/count mismatch".into());
        }
        if let Some(issue) = programmatic_resources::validate(&request.resources).first() {
            return Err(issue.message.clone());
        }
        let expected: BTreeSet<_> = std::iter::once(request.settings.palette_resource.as_str())
            .chain(
                request
                    .settings
                    .images
                    .iter()
                    .map(|b| b.resource_id.as_str()),
            )
            .collect();
        if expected.len() != request.resources.len()
            || request
                .resources
                .iter()
                .any(|r| !expected.contains(r.id.as_str()))
        {
            return Err("LUT atlas manifest contains missing/extra resources".into());
        }
        let mut end = 0;
        let mut bodies = BTreeMap::new();
        for part in &request.byte_layout {
            end = transport::range(part.offset, part.length, binary.len(), end)?;
            if !expected.contains(part.resource_id.as_str())
                || bodies
                    .insert(part.resource_id.clone(), &binary[part.offset..end])
                    .is_some()
            {
                return Err("LUT atlas binary layout resource missing/duplicate".into());
            }
        }
        if end != binary.len() {
            return Err("LUT atlas unclaimed trailing binary bytes".into());
        }
        let decoded: Vec<_> = request
            .decoded_images
            .iter()
            .map(|d| DecodedImage {
                resource_id: d.resource_id.clone(),
                width: d.width,
                height: d.height,
            })
            .collect();
        let plan = mv_lut_atlas::build(&request.settings, &request.resources, &bodies, &decoded)?;
        let samples = request
            .required_aliases
            .iter()
            .map(|alias| Ok((alias.clone(), plan.row_sample(alias)?)))
            .collect::<Result<BTreeMap<_, _>, String>>()?;
        if samples.len() != request.required_aliases.len() {
            return Err("LUT atlas required alias request is duplicate".into());
        }
        let serialized = serde_json::to_vec(&plan).map_err(|e| e.to_string())?;
        let bytes = serialized
            .len()
            .checked_mul(32)
            .and_then(|v| v.checked_add(16 * 1024))
            .ok_or("LUT atlas owner residency overflow")?;
        let total = self
            .resident
            .checked_add(bytes)
            .filter(|v| *v <= transport::MAX_SESSION_BYTES)
            .ok_or("LUT atlas owner residency budget exceeded")?;
        let session_id = self
            .next
            .checked_add(1)
            .ok_or("LUT atlas owner session ID exhausted")?;
        let receipt = Prepared {
            session_id,
            plan: serde_json::from_slice(&serialized).map_err(|e| e.to_string())?,
            samples,
        };
        self.sessions.insert(
            session_id,
            Session {
                plan,
                rows: BTreeMap::new(),
                bytes,
            },
        );
        self.next = session_id;
        self.resident = total;
        Ok(receipt)
    }
    fn session(&self, id: u32) -> Result<&Session, String> {
        self.sessions
            .get(&id)
            .ok_or_else(|| "LUT atlas stale/unknown owner session".into())
    }
    pub fn sample(&self, id: u32, alias: &str) -> Result<RowSample, String> {
        if alias.len() > 128 {
            return Err("LUT atlas alias length exceeds limit".into());
        }
        self.session(id)?.plan.row_sample(alias)
    }
    pub fn resolve_parameters(&self, id: u32, json: &str) -> Result<Value, String> {
        if json.len() > 128 * 1024 {
            return Err("LUT atlas post parameter transport too large".into());
        }
        let parameters: Value = serde_json::from_str(json)
            .map_err(|e| format!("LUT atlas invalid post parameter JSON: {e}"))?;
        self.session(id)?.plan.resolve_post_parameters(&parameters)
    }
    pub fn bind_row(&mut self, id: u32, alias: &str, rgba: &[u8]) -> Result<BoundRow, String> {
        validate_row_lengths(rgba.len())?;
        let sample = self.sample(id, alias)?;
        let session = self
            .sessions
            .get_mut(&id)
            .ok_or("LUT atlas stale owner session")?;
        if !session.rows.contains_key(alias) && session.rows.len() >= 16 {
            return Err("LUT atlas owner row cache exhausted".into());
        }
        let pixels = mv_lut_atlas::prepare_row_pixels(&session.plan, &sample, rgba)?;
        let receipt = BoundRow {
            session_id: id,
            alias: alias.into(),
            sample,
            byte_length: pixels.pixels().len(),
            sampled_sha256: pixels.sampled_sha256().into(),
        };
        session.rows.insert(alias.into(), pixels);
        Ok(receipt)
    }
    pub fn row_pixels(&self, id: u32, alias: &str) -> Result<&RowPixels, String> {
        self.session(id)?
            .rows
            .get(alias)
            .ok_or_else(|| "LUT atlas row pixels have not been native-admitted".into())
    }
    pub fn dispose(&mut self, id: u32) {
        if let Some(session) = self.sessions.remove(&id) {
            self.resident = self.resident.saturating_sub(session.bytes);
        }
    }
    pub fn clear(&mut self) {
        self.sessions.clear();
        self.resident = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};
    fn fixture() -> (String, Vec<u8>) {
        let png:Vec<u8>="89504e470d0a1a0a0000000d4948445200000100000000010802000000be3be720000000ad49444154789c754ecb0ec3200c8b83e88ebbedffff94c97910a0ad5a19c7760ce8df9f8808401422826f62717e0f622ae96f6228597c2fdc95f990e72b5c5a5688ae823c28c5ec70122598dc8cbd242f0aab7a6ea3f1b9758cf3a235326b4efd70df6276ee3d2f8bb1a22aaa30bc9146de4adc33e6fadfd6c0a29755e2a012e3884c0be24aa33b14601250d81bf854341b8dd08a408edc35a465b1a30472413e5a7841ba13959e2389a1f3fe07292b07d7326c00140000000049454e44ae426082".as_bytes().chunks_exact(2).map(|v|u8::from_str_radix(std::str::from_utf8(v).unwrap(),16).unwrap()).collect();
        let json = br#"{"palettes":[{"id":"P4_fixture","lut":"lut.png","lut_duotone":"duo.png"}]}"#;
        let resource = |id: &str, kind: &str, mime: &str, b: &[u8]| {
            let sha = format!("{:x}", Sha256::digest(b));
            serde_json::json!({"id":id,"kind":kind,"mimeType":mime,"byteLength":b.len(),"sha256":sha,"attachmentKey":format!("programmatic-sha256-{sha}")})
        };
        let metadata = serde_json::json!({"settings":{"paletteResource":"pal","images":[{"path":"lut.png","resourceId":"lut"},{"path":"duo.png","resourceId":"duo"}]},"resources":[resource("pal","analysis","application/json",json),resource("lut","image","image/png",&png),resource("duo","image","image/png",&png)],"byteLayout":[{"resourceId":"pal","offset":0,"length":json.len()},{"resourceId":"lut","offset":json.len(),"length":png.len()},{"resourceId":"duo","offset":json.len()+png.len(),"length":png.len()}],"decodedImages":[{"resourceId":"lut","width":256,"height":1},{"resourceId":"duo","width":256,"height":1}],"requiredAliases":["P4"]});
        let binary = [json.as_slice(), png.as_slice(), png.as_slice()].concat();
        (metadata.to_string(), binary)
    }
    #[test]
    fn actual_resource_manifest_owner_resolution_pixel_binding_and_dispose() {
        let (metadata, binary) = fixture();
        let mut owner = AtlasSessions::default();
        let receipt = owner.prepare(&metadata, &binary).unwrap();
        let id = receipt.session_id;
        assert_eq!(receipt.plan["aliases"]["P4"], 0);
        assert_eq!(
            owner
                .resolve_parameters(id, r#"{"lutA":"P4","lutMix":0.18}"#)
                .unwrap()["lutB"],
            0
        );
        assert!(owner.row_pixels(id, "P4").is_err());
        let pixels = vec![123; 1024];
        let row = owner.bind_row(id, "P4", &pixels).unwrap();
        assert_eq!(row.byte_length, 1024);
        assert_eq!(owner.row_pixels(id, "P4").unwrap().pixels(), pixels);
        assert!(owner.bind_row(id, "P4", &pixels[..1023]).is_err());
        owner.dispose(id);
        assert!(owner.sample(id, "P4").is_err());
        assert_eq!(owner.resident, 0);
    }
    #[test]
    fn wrong_sha_facts_ranges_aliases_and_extra_resources_fail_closed() {
        let (metadata, binary) = fixture();
        let mut owner = AtlasSessions::default();
        let mut changed = binary.clone();
        let last = changed.len() - 1;
        changed[last] ^= 1;
        assert!(owner.prepare(&metadata, &changed).is_err());
        for (field, value) in [
            ("width", serde_json::json!(255)),
            ("height", serde_json::json!(2)),
        ] {
            let mut m: Value = serde_json::from_str(&metadata).unwrap();
            m["decodedImages"][0][field] = value;
            assert!(owner.prepare(&m.to_string(), &binary).is_err());
        }
        let mut m: Value = serde_json::from_str(&metadata).unwrap();
        m["byteLayout"][1]["offset"] = serde_json::json!(0);
        assert!(owner.prepare(&m.to_string(), &binary).is_err());
        let mut m: Value = serde_json::from_str(&metadata).unwrap();
        m["requiredAliases"] = serde_json::json!(["missing"]);
        assert!(owner.prepare(&m.to_string(), &binary).is_err());
        let mut m: Value = serde_json::from_str(&metadata).unwrap();
        let duplicate = m["resources"][0].clone();
        m["resources"].as_array_mut().unwrap().push(duplicate);
        assert!(owner.prepare(&m.to_string(), &binary).is_err());
        assert!(owner.sessions.is_empty());
    }
    #[test]
    fn owner_is_bounded_and_clear_does_not_reuse_stale_ids() {
        let (metadata, binary) = fixture();
        let mut owner = AtlasSessions::default();
        let mut first = 0;
        for i in 0..8 {
            let id = owner.prepare(&metadata, &binary).unwrap().session_id;
            if i == 0 {
                first = id;
            }
        }
        assert!(owner.prepare(&metadata, &binary).is_err());
        owner.clear();
        assert_eq!(owner.resident, 0);
        let fresh = owner.prepare(&metadata, &binary).unwrap().session_id;
        assert!(fresh > first);
        assert!(owner.sample(first, "P4").is_err());
    }
}

use super::*;
impl Owner {
    pub fn source_requests_json(args: &str, resources: &str) -> Result<String, String> {
        let args: memories::model::Args = parse(args)?;
        let resources: Vec<crate::programmatic_resources::Resource> = parse(resources)?;
        if let Some(issue) = crate::programmatic_resources::validate(&resources).first() {
            return Err(issue.message.clone());
        }
        let selection = memories::model::select(&args)?;
        let mut ids: BTreeSet<_> = args.photos.iter().map(|p| p.bg.clone()).collect();
        if let Some(id) = selection.character {
            ids.insert(id);
        }
        let find = |id: &str| {
            resources
                .iter()
                .find(|r| r.id == id)
                .cloned()
                .ok_or_else(|| "Memories requested source missing".to_string())
        };
        let images: Vec<_> = ids.iter().map(|id| find(id)).collect::<Result<_, _>>()?;
        let requests = memories::admission::measurement_requests(&args)?;
        let fonts: Vec<_> = requests
            .iter()
            .map(|q| find(&q.font))
            .collect::<Result<_, _>>()?;
        json(
            &serde_json::json!({"images":images,"fonts":fonts,"measurements":requests,"photos":args.photos.len()}),
        )
    }
    /// Header/SFNT admission before native decode/load/measurement allocation.
    pub fn source_admission_json(
        args: &str,
        resource: &str,
        bytes: &[u8],
    ) -> Result<String, String> {
        let a: memories::model::Args = parse(args)?;
        let r: crate::programmatic_resources::Resource = parse(resource)?;
        if !crate::programmatic_resources::validate(&[r.clone()]).is_empty()
            || bytes.len() as u64 != r.byte_length()
            || hash(bytes) != r.sha256()
        {
            return Err("Memories source encoded admission mismatch".into());
        }
        if r.kind == "image" {
            let (width, height) =
                crate::image_sequence::inspect_encoded_image(r.mime_type(), bytes)?;
            crate::image_sequence::decoded_image_bytes(width, height)?;
            return json(&serde_json::json!({"width":width,"height":height}));
        }
        let request = memories::admission::measurement_requests(&a)?
            .into_iter()
            .find(|q| q.font == r.id)
            .ok_or("Memories source is not a selected font")?;
        let f = protocol::Font {
            resource: r,
            encoded: protocol::Range {
                offset: 0,
                length: bytes.len(),
            },
            font_size: request.font_size,
            weight: request.weight,
            widths: BTreeMap::new(),
        };
        fonts::admit(&f, bytes, &request.texts)?;
        json(
            &serde_json::json!({"font":request.font,"fontSize":request.font_size,"weight":request.weight,"texts":request.texts}),
        )
    }
}

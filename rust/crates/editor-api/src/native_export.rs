//! Pure native export admission and durable receipt rules. Platform adapters own
//! source reads, IDs, clocks, renderer transport and files, never these decisions.
use bridge::export;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

const MAX_SAFE: u64 = 9_007_199_254_740_991;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Range {
    start_time: u64,
    end_time: u64,
}

fn yes() -> bool {
    true
}
fn chroma() -> String {
    "420".into()
}
fn present<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(
    deserializer: D,
) -> std::result::Result<Option<T>, D::Error> {
    T::deserialize(deserializer).map(Some)
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Options {
    format: String,
    quality: String,
    #[serde(default = "yes")]
    include_audio: bool,
    #[serde(default = "chroma")]
    video_chroma: String,
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    video_quantizer: Option<u8>,
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    range: Option<Range>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    schema_version: u8,
    project_id: String,
    expected_revision: u64,
    idempotency_key: String,
    options: Options,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Source {
    project_id: String,
    revision: u64,
    data: Value,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Output {
    descriptor: String,
    bytes: u64,
    sha256: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Publication {
    output: Output,
    staging_descriptor: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
enum Phase {
    Reserved,
    Dispatched,
    Running,
    Publishing,
    Completed,
    Failed,
    Cancelled,
    OutcomeUnknown,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Record {
    schema_version: u8,
    job_id: String,
    request: Request,
    request_hash: String,
    source_revision: u64,
    source_digest: String,
    phase: Phase,
    cancel_requested: bool,
    progress: f64,
    output: Option<Output>,
    #[serde(default)]
    publication: Option<Publication>,
    error: Option<String>,
    created_at: u64,
    updated_at: u64,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
enum Event {
    Dispatched,
    Running {
        progress: f64,
    },
    CancelRequest,
    CancelConfirmed,
    Failed {
        error: String,
    },
    DispatchUnknown {
        error: String,
    },
    Recover,
    Complete {
        output: Output,
    },
    PublicationStart {
        output: Output,
        #[serde(rename = "stagingDescriptor")]
        staging_descriptor: String,
    },
    PublicationConfirmed {
        output: Output,
    },
}

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "camelCase", deny_unknown_fields)]
enum Input {
    Admit {
        request: Request,
        source: Source,
        #[serde(rename = "jobId")]
        job_id: String,
        now: u64,
        #[serde(default, deserialize_with = "present")]
        existing: Option<Value>,
    },
    Transition {
        record: Value,
        event: Event,
        now: u64,
        #[serde(default, deserialize_with = "present")]
        source: Option<Source>,
    },
    Verify {
        record: Value,
        #[serde(default, deserialize_with = "present")]
        source: Option<Source>,
        #[serde(default, deserialize_with = "present")]
        output: Option<Output>,
    },
    ValidateOutput {
        format: String,
        bytes: Vec<u8>,
        #[serde(rename = "byteLength")]
        byte_length: u64,
    },
}

type Failure = (&'static str, String);
type Result<T> = std::result::Result<T, Failure>;
fn refuse<T>(code: &'static str, message: &str) -> Result<T> {
    Err((code, message.into()))
}
fn text(value: &str, max: usize) -> bool {
    !value.is_empty() && value.len() <= max && !value.chars().any(char::is_control)
}
fn digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}
fn terminal(phase: Phase) -> bool {
    matches!(phase, Phase::Completed | Phase::Failed | Phase::Cancelled)
}

fn canonical(value: &Value) -> String {
    match value {
        Value::Object(map) => {
            let sorted: BTreeMap<_, _> = map.iter().collect();
            format!(
                "{{{}}}",
                sorted
                    .into_iter()
                    .map(|(key, value)| format!(
                        "{}:{}",
                        serde_json::to_string(key).unwrap(),
                        canonical(value)
                    ))
                    .collect::<Vec<_>>()
                    .join(",")
            )
        }
        Value::Array(array) => format!(
            "[{}]",
            array.iter().map(canonical).collect::<Vec<_>>().join(",")
        ),
        _ => value.to_string(),
    }
}

fn hash(domain: &str, value: &Value) -> String {
    let mut hash = Sha256::new();
    hash.update(domain.as_bytes());
    hash.update([0]);
    hash.update(canonical(value).as_bytes());
    format!("{:x}", hash.finalize())
}

fn request_hash(request: &Request, revision: u64, source_digest: &str) -> String {
    hash(
        "rocut-native-export-request/1",
        &json!({"request":request,"sourceRevision":revision,"sourceDigest":source_digest,
            "timeBaseTicksPerSecond":time::TICKS_PER_SECOND}),
    )
}

fn source_digest(source: &Source) -> Result<String> {
    let Some(data) = source.data.as_object() else {
        return refuse("invalid-source", "Source data must be a project object");
    };
    if !data.get("scenes").is_some_and(Value::is_array)
        || !data.get("settings").is_some_and(Value::is_object)
        || !data
            .get("currentSceneId")
            .and_then(Value::as_str)
            .is_some_and(|id| text(id, 500))
        || !data
            .get("version")
            .and_then(Value::as_u64)
            .is_some_and(|version| version <= MAX_SAFE)
    {
        return refuse(
            "invalid-source",
            "Source requires actual scenes, scene identity, settings and version",
        );
    }
    // Persisted projects and live native serialization share this projection.
    // Scene timestamps are UI/persistence metadata, not rendering inputs; their
    // ISO spelling must not fence an otherwise identical decoded snapshot.
    let mut scenes = data["scenes"].clone();
    for scene in scenes.as_array_mut().unwrap() {
        let Some(scene) = scene.as_object_mut() else {
            return refuse("invalid-source", "Source scenes must be objects");
        };
        scene.remove("createdAt");
        scene.remove("updatedAt");
        match scene.get("bookmarks") {
            None => {
                scene.insert("bookmarks".into(), json!([]));
            }
            Some(value) if value.is_array() => {}
            _ => return refuse("invalid-source", "Scene bookmarks must be an array"),
        }
        scene.entry("isMain").or_insert(json!(false));
        if let Some(tracks) = scene.get_mut("tracks").and_then(Value::as_object_mut) {
            for key in ["overlay", "audio"] {
                tracks.entry(key).or_insert(json!([]));
            }
            for key in ["overlay", "audio"] {
                if let Some(tracks) = tracks.get_mut(key).and_then(Value::as_array_mut) {
                    for track in tracks {
                        if let Some(track) = track.as_object_mut() {
                            track.entry("elements").or_insert(json!([]));
                        }
                    }
                }
            }
            if let Some(main) = tracks.get_mut("main").and_then(Value::as_object_mut) {
                main.entry("elements").or_insert(json!([]));
            }
        }
    }
    let sequences = match data.get("motionTextSequences") {
        None => json!([]),
        Some(value) if value.is_array() => value.clone(),
        _ => return refuse("invalid-source", "Motion text sequences must be an array"),
    };
    // The platform uses its established native serializer, preserving retained
    // opaque extensions, rather than rebuilding this semantic hash in JS.
    Ok(hash(
        "rocut-native-export-source/1",
        &json!({
            "scenes":scenes,
            "motionTextSequences":sequences,
            "currentSceneId":data.get("currentSceneId").unwrap_or(&Value::Null),
            "settings":data.get("settings").unwrap_or(&Value::Null),
            "version":data.get("version").unwrap_or(&Value::Null)
        }),
    ))
}

fn validate_request(request: &Request) -> Result<()> {
    if request.schema_version != 1
        || !text(&request.project_id, 500)
        || !text(&request.idempotency_key, 200)
        || request.expected_revision > MAX_SAFE
    {
        return refuse(
            "invalid-request",
            "Invalid export request identity or revision",
        );
    }
    let options = &request.options;
    if !matches!(options.format.as_str(), "mp4" | "webm")
        || !matches!(
            options.quality.as_str(),
            "low" | "medium" | "high" | "very_high"
        )
        || !matches!(options.video_chroma.as_str(), "420" | "444")
    {
        return refuse("invalid-request", "Invalid export options");
    }
    if let Some(range) = &options.range {
        if range.start_time >= range.end_time || range.end_time > MAX_SAFE {
            return refuse(
                "invalid-request",
                "Range must be safe nonnegative half-open media ticks",
            );
        }
    }
    // Reuse the authoritative codec/format/quantizer policy. These fixed probe
    // dimensions only validate the option combination, never advertise a render
    // spec or encoder plan; actual dimensions/frame rate are resolved by renderer.
    let mut probe = json!({"width":1,"height":1,"frameRate":{"numerator":30,"denominator":1},
        "codec":if options.format == "webm" {"vp9"} else {"avc"},
        "format":options.format,"quality":options.quality,"videoChroma":options.video_chroma});
    if let Some(quantizer) = options.video_quantizer {
        probe["videoQuantizer"] = json!(quantizer);
    }
    let policy: Value = serde_json::from_str(&crate::video_export::resolve_video_export_json(
        probe.to_string(),
    ))
    .map_err(|_| {
        (
            "policy-unavailable",
            "Native video export policy returned malformed data".into(),
        )
    })?;
    if let Some(error) = policy.get("error") {
        return Err((
            "invalid-request",
            error
                .as_str()
                .unwrap_or("Invalid native export options")
                .into(),
        ));
    }
    Ok(())
}

fn validate_output(output: &Output) -> Result<()> {
    let name = output.descriptor.strip_prefix("file:").unwrap_or("");
    if name.is_empty()
        || name.len() > 200
        || !name
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_' | b'.'))
        || name == "."
        || name == ".."
        || name.ends_with('.')
        || output.bytes == 0
        || output.bytes > MAX_SAFE
        || !digest(&output.sha256)
    {
        return refuse(
            "invalid-output",
            "Output needs an opaque file name and verified nonempty bytes/hash",
        );
    }
    Ok(())
}

fn read_record(value: Value) -> Result<Record> {
    if value.get("schemaVersion") != Some(&json!(1))
        || value.get("requestHash").is_none()
        || value.get("sourceDigest").is_none()
    {
        return refuse(
            "unverified",
            "Legacy export ledger lacks admission evidence",
        );
    }
    let record: Record = serde_json::from_value(value)
        .map_err(|_| ("invalid-record", "Malformed native export record".into()))?;
    validate_request(&record.request)?;
    if record.schema_version != 1
        || !text(&record.job_id, 128)
        || !record
            .job_id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_'))
        || !digest(&record.source_digest)
        || record.source_revision != record.request.expected_revision
        || record.request_hash
            != request_hash(
                &record.request,
                record.source_revision,
                &record.source_digest,
            )
        || record.created_at > record.updated_at
        || record.updated_at > MAX_SAFE
        || !record.progress.is_finite()
        || !(0.0..=1.0).contains(&record.progress)
    {
        return refuse(
            "invalid-record",
            "Native export record identity or fingerprint is invalid",
        );
    }
    if record.phase == Phase::Completed {
        let Some(output) = &record.output else {
            return refuse("invalid-record", "Completed record has no output evidence");
        };
        validate_output(output)?;
        if record.progress != 1.0 || record.error.is_some() {
            return refuse(
                "invalid-record",
                "Completed record has inconsistent terminal evidence",
            );
        }
    } else if record.output.is_some() {
        return refuse("invalid-record", "Noncompleted record cannot expose output");
    }
    if let Some(publication) = &record.publication {
        validate_output(&publication.output)?;
        validate_output(&Output {
            descriptor: publication.staging_descriptor.clone(),
            ..publication.output.clone()
        })?;
        if !matches!(record.phase, Phase::Publishing | Phase::OutcomeUnknown)
            || publication.staging_descriptor == publication.output.descriptor
        {
            return refuse(
                "invalid-record",
                "Publication intent requires distinct staged evidence and a pending phase",
            );
        }
    } else if record.phase == Phase::Publishing {
        return refuse(
            "invalid-record",
            "Publishing requires durable candidate evidence",
        );
    }
    if matches!(record.phase, Phase::Failed | Phase::OutcomeUnknown)
        && !record.error.as_ref().is_some_and(|error| text(error, 2000))
    {
        return refuse(
            "invalid-record",
            "Failure or unknown outcome requires a reason",
        );
    }
    Ok(record)
}

fn fence(record: &Record, source: Option<&Source>) -> Result<()> {
    let Some(source) = source else {
        return refuse(
            "source-required",
            "Authoritative source is required for this transition",
        );
    };
    if source.project_id != record.request.project_id
        || source.revision != record.source_revision
        || source_digest(source)? != record.source_digest
    {
        return refuse(
            "revision-conflict",
            "Export source identity, revision or content changed",
        );
    }
    Ok(())
}

fn run(input: Input) -> Result<Value> {
    match input {
        Input::ValidateOutput {
            format,
            bytes,
            byte_length,
        } => {
            if bytes.len() > 64
                || byte_length < 32
                || byte_length > MAX_SAFE
                || bytes.len() as u64 > byte_length
            {
                return refuse(
                    "invalid-output",
                    "Container evidence requires a bounded actual header and safe byte length",
                );
            }
            let accepted = match format.as_str() {
                "webm" => bytes.starts_with(&[0x1a, 0x45, 0xdf, 0xa3]),
                "mp4" if bytes.len() >= 12 && &bytes[4..8] == b"ftyp" => {
                    let box_size = u32::from_be_bytes(bytes[..4].try_into().unwrap());
                    u64::from(box_size) <= byte_length && box_size >= 12
                }
                _ => false,
            };
            if !accepted {
                return refuse(
                    "invalid-output",
                    "Actual bytes do not match the requested container header",
                );
            }
            Ok(json!({"schemaVersion":1,"status":"output-valid","scope":"container-header-only"}))
        }
        Input::Admit {
            request,
            source,
            job_id,
            now,
            existing,
        } => {
            validate_request(&request)?;
            if now > MAX_SAFE {
                return refuse("invalid-clock", "Clock must be a safe nonnegative integer");
            }
            if let Some(existing) = existing {
                let record = read_record(existing)?;
                if record.request != request {
                    return refuse(
                        "idempotency-conflict",
                        "Idempotency key belongs to a different frozen request",
                    );
                }
                // Replay is a receipt read, not new admission. Current project
                // changes must not cause a duplicate native execution.
                return Ok(json!({"schemaVersion":1,"status":"replay","record":record}));
            }
            if source.project_id != request.project_id
                || source.revision != request.expected_revision
            {
                return refuse(
                    "revision-conflict",
                    "Requested source revision is not current",
                );
            }
            let source_digest = source_digest(&source)?;
            let record = Record {
                schema_version: 1,
                job_id,
                request_hash: request_hash(&request, source.revision, &source_digest),
                request,
                source_revision: source.revision,
                source_digest,
                phase: Phase::Reserved,
                cancel_requested: false,
                progress: 0.0,
                output: None,
                publication: None,
                error: None,
                created_at: now,
                updated_at: now,
            };
            let record = read_record(serde_json::to_value(record).unwrap())?;
            Ok(json!({"schemaVersion":1,"status":"reserved","record":record}))
        }
        Input::Verify {
            record,
            source,
            output,
        } => {
            let record = match read_record(record) {
                Err(("unverified", reason)) => {
                    return Ok(json!({"schemaVersion":1,"status":"unverified","reason":reason}));
                }
                result => result?,
            };
            if source.is_some() {
                fence(&record, source.as_ref())?;
            }
            if let Some(output) = output {
                validate_output(&output)?;
                if record.phase != Phase::Completed || record.output.as_ref() != Some(&output) {
                    return refuse(
                        "output-conflict",
                        "Actual output does not match the completed receipt",
                    );
                }
            }
            Ok(json!({"schemaVersion":1,"status":"verified","record":record}))
        }
        Input::Transition {
            record,
            event,
            now,
            source,
        } => {
            let mut record = read_record(record)?;
            if now < record.updated_at || now > MAX_SAFE {
                return refuse("invalid-clock", "Transition clock must not go backwards");
            }
            if terminal(record.phase) {
                match &event {
                    Event::Complete { output } | Event::PublicationConfirmed { output }
                        if record.phase == Phase::Completed
                            && record.output.as_ref() == Some(output) => {}
                    Event::Recover | Event::CancelRequest => {}
                    Event::CancelConfirmed if record.phase == Phase::Cancelled => {}
                    _ => {
                        return refuse(
                            "terminal-conflict",
                            "A terminal export cannot be reopened or replaced",
                        );
                    }
                }
                return Ok(json!({"schemaVersion":1,"status":"updated","record":record}));
            }
            match event {
                Event::Dispatched => {
                    if record.phase != Phase::Reserved || record.cancel_requested {
                        return refuse(
                            "phase-conflict",
                            "Only an uncancelled reservation can be dispatched",
                        );
                    }
                    fence(&record, source.as_ref())?;
                    record.phase = Phase::Dispatched;
                }
                Event::Running { progress } => {
                    if !matches!(record.phase, Phase::Dispatched | Phase::Running)
                        || record.cancel_requested
                        || !progress.is_finite()
                        || progress < record.progress
                        || progress > 1.0
                    {
                        return refuse(
                            "phase-conflict",
                            "Running progress must be monotone on an active uncancelled export",
                        );
                    }
                    fence(&record, source.as_ref())?;
                    record.phase = Phase::Running;
                    record.progress = progress;
                }
                Event::CancelRequest => record.cancel_requested = true,
                Event::CancelConfirmed => {
                    if record.publication.is_some() {
                        return refuse(
                            "cancel-conflict",
                            "Publication intent cannot claim renderer cancellation",
                        );
                    }
                    if !record.cancel_requested {
                        return refuse(
                            "cancel-conflict",
                            "Cancellation intent must precede confirmed termination",
                        );
                    }
                    record.phase = Phase::Cancelled;
                    record.error = None;
                }
                Event::Failed { error } => {
                    if record.publication.is_some() {
                        return refuse(
                            "phase-conflict",
                            "Publication outcome requires reconciliation, not producer failure",
                        );
                    }
                    if !text(&error, 2000) {
                        return refuse(
                            "invalid-event",
                            "Outcome requires a bounded nonempty reason",
                        );
                    }
                    record.phase = Phase::Failed;
                    record.error = Some(error);
                }
                Event::DispatchUnknown { error } => {
                    if !text(&error, 2000) {
                        return refuse(
                            "invalid-event",
                            "Outcome requires a bounded nonempty reason",
                        );
                    }
                    record.phase = Phase::OutcomeUnknown;
                    record.error = Some(error);
                }
                Event::Recover => {
                    if record.phase == Phase::Publishing {
                        return Ok(json!({"schemaVersion":1,"status":"updated","record":record}));
                    }
                    record.phase = Phase::OutcomeUnknown;
                    record.error = Some(
                        "Previous producer outcome requires authoritative reconciliation".into(),
                    );
                }
                Event::Complete { output } => {
                    if !matches!(record.phase, Phase::Dispatched | Phase::Running)
                        || record.cancel_requested
                    {
                        return refuse(
                            "phase-conflict",
                            "Only actual active uncancelled work can complete",
                        );
                    }
                    fence(&record, source.as_ref())?;
                    validate_output(&output)?;
                    record.phase = Phase::Completed;
                    record.progress = 1.0;
                    record.output = Some(output);
                    record.error = None;
                }
                Event::PublicationStart {
                    output,
                    staging_descriptor,
                } => {
                    if !matches!(record.phase, Phase::Dispatched | Phase::Running)
                        || record.cancel_requested
                    {
                        return refuse(
                            "phase-conflict",
                            "Only active uncancelled work can begin publication",
                        );
                    }
                    fence(&record, source.as_ref())?;
                    validate_output(&output)?;
                    validate_output(&Output {
                        descriptor: staging_descriptor.clone(),
                        ..output.clone()
                    })?;
                    if staging_descriptor == output.descriptor {
                        return refuse(
                            "invalid-output",
                            "Staged and published descriptors must differ",
                        );
                    }
                    record.phase = Phase::Publishing;
                    record.publication = Some(Publication {
                        output,
                        staging_descriptor,
                    });
                    record.error = None;
                }
                Event::PublicationConfirmed { output } => {
                    let Some(publication) = &record.publication else {
                        return refuse(
                            "phase-conflict",
                            "Publication confirmation requires durable intent",
                        );
                    };
                    if !matches!(record.phase, Phase::Publishing | Phase::OutcomeUnknown)
                        || publication.output != output
                    {
                        return refuse(
                            "output-conflict",
                            "Actual published evidence must match the frozen candidate",
                        );
                    }
                    // Encoding was fenced at intent. Later edits do not change
                    // the original request's frozen source or published bytes.
                    record.phase = Phase::Completed;
                    record.output = Some(publication.output.clone());
                    record.publication = None;
                    record.progress = 1.0;
                    // Preserve cancellation intent as receipt audit evidence:
                    // actual publication completion does not claim cancellation.
                    record.error = None;
                }
            }
            record.updated_at = now;
            Ok(json!({"schemaVersion":1,"status":"updated","record":record}))
        }
    }
}

#[export]
pub fn resolve_native_export_job_json(input: String) -> String {
    let result = if input.len() > 8 * 1024 * 1024 {
        refuse(
            "input-limit",
            "Native export request exceeds its size limit",
        )
    } else {
        serde_json::from_str::<Input>(&input)
            .map_err(|_| ("invalid-schema", "Invalid native export JSON ABI".into()))
            .and_then(run)
    };
    match result {
        Ok(value) => value.to_string(),
        Err((code, message)) => {
            json!({"schemaVersion":1,"status":"rejected","error":{"code":code,"message":message}})
                .to_string()
        }
    }
}

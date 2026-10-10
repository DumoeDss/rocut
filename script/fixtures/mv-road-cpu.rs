//! Native Road safety/oracle harness; actual scene and resource-policy leaves.
mod model {
    #[derive(serde::Serialize)]
    pub struct Issue {
        pub message: String,
    }
    impl Issue {
        pub fn new(_: &str, message: &str) -> Self {
            Self {
                message: message.into(),
            }
        }
    }
}
mod image_sequence {
    pub const MIME: &str = "application/vnd.rocut.image-sequence+json";
    pub fn decoded_image_bytes(w: u32, h: u32) -> Result<u64, String> {
        let n = w as u64 * h as u64 * 4;
        if w == 0 || h == 0 || w > 8192 || h > 8192 || n > 128 * 1024 * 1024 {
            Err("Encoded image geometry exceeds budget".into())
        } else {
            Ok(n)
        }
    }
}
#[path = "../../rust/crates/editor-api/src/programmatic_resources.rs"]
mod programmatic_resources;
mod mv_recipe {
    #[path = "E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut/rust/crates/editor-api/src/mv_recipe/road.rs"]
    pub mod road;
}
fn main() {
    use mv_recipe::road::{
        self,
        model::{Args, Sample},
        ImageFact, Session,
    };
    // Optional private fixture input comes from the actual native decoder in the
    // pixel gate. It is not a production author-JSON capability.
    let input = std::env::var("MV_ROAD_CPU_NATIVE_FACT")
        .ok()
        .map(|v| serde_json::from_str::<serde_json::Value>(&v).unwrap());
    let image: programmatic_resources::Resource = if let Some(input) = &input {
        serde_json::from_value(input["resource"].clone()).unwrap()
    } else {
        serde_json::from_value(serde_json::json!({"id":"runner.png","kind":"image","attachmentKey":format!("programmatic-sha256-{}","a".repeat(64)),"mimeType":"image/png","byteLength":16,"sha256":"a".repeat(64)})).unwrap()
    };
    let size = input
        .as_ref()
        .map(|v| {
            [
                v["width"].as_u64().unwrap() as u32,
                v["height"].as_u64().unwrap() as u32,
            ]
        })
        .unwrap_or([320, 640]);
    let beats: Vec<u64> = (0..=400).map(|i| i * 60000).collect();
    let mut rows = Vec::new();
    for (args, start, end, times, stops, downbeats) in [
        (
            serde_json::json!({"mode":"tear"}),
            0.0,
            7.29,
            vec![0.0, 0.2, 1.49, 1.5, 1.6, 1.9, 2.3, 3.1, 4.2, 5.0, 6.4, 7.29],
            vec![],
            vec![],
        ),
        (
            serde_json::json!({"mode":"run","char":"runner.png"}),
            176.48,
            179.9,
            vec![
                176.48, 176.6, 177.19, 177.2, 177.4, 177.6, 178.2, 179.29, 179.3, 179.35, 179.5,
                179.9,
            ],
            vec![179.3],
            vec![177.2],
        ),
    ] {
        let a: Args = serde_json::from_value(args.clone()).unwrap();
        let (resources, fact) = if a.mode == road::model::Mode::Run {
            (
                vec![image.clone()],
                Some(ImageFact {
                    resource: image.clone(),
                    width: size[0],
                    height: size[1],
                }),
            )
        } else {
            (vec![], None)
        };
        let session = Session::prepare(a, resources.clone(), fact, 256 * 1024 * 1024).unwrap();
        let stop_ticks: Vec<u64> = stops
            .iter()
            .map(|t| (*t * 120000.0_f64).round() as u64)
            .collect();
        let down_ticks: Vec<u64> = downbeats
            .iter()
            .map(|t| (*t * 120000.0_f64).round() as u64)
            .collect();
        for t in times {
            let plan = session
                .frame(&Sample {
                    song_ticks: (t * 120000.0_f64).round() as u64,
                    shot_start_ticks: (start * 120000.0_f64).round() as u64,
                    shot_end_ticks: (end * 120000.0_f64).round() as u64,
                    beats: &beats,
                    bpm: 120.0,
                    stops: &stop_ticks,
                    downbeats: &down_ticks,
                    resources: &resources,
                })
                .unwrap();
            rows.push(serde_json::json!({"args":args,"t":t,"start":start,"end":end,"stops":stops,"downbeats":downbeats,"character":{"resource":image,"width":size[0],"height":size[1]},"plan":plan}));
        }
    }
    use std::io::Write;
    let mut out = std::io::BufWriter::new(std::io::stdout().lock());
    out.write_all(serde_json::to_string(&rows).unwrap().as_bytes())
        .unwrap();
}

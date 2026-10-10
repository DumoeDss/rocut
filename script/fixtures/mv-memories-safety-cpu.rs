//! Lightweight native harness: actual Memories, paint and resource-policy leaves.
//! The two unrelated crate seams below are bounded stubs, not pixel parity.
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
    // This harness compiles the owner against a bounded unrelated image seam;
    // encoded-image admission itself is exercised by its production crate tests.
    pub fn inspect_encoded_image(_: &str, _: &[u8]) -> Result<(u32, u32), String> {
        Err("CPU owner harness does not decode encoded sources".into())
    }
    pub fn decoded_image_bytes(width: u32, height: u32) -> Result<u64, String> {
        let bytes = width as u64 * height as u64 * 4;
        if width == 0 || height == 0 || width > 8192 || height > 8192 || bytes > 128 * 1024 * 1024 {
            Err("Encoded image geometry exceeds the image sequence decode budget".into())
        } else {
            Ok(bytes)
        }
    }
}
#[path = "../../rust/crates/editor-api/src/mv_memories_owner.rs"]
mod mv_memories_owner;
mod mv_image_preprocess {
    #[derive(serde::Serialize)]
    pub struct Request;
}
#[path = "../../rust/crates/editor-api/src/programmatic_resources.rs"]
mod programmatic_resources;
mod mv_recipe {
    pub mod model {
        pub type Color = [f64; 4];
    }
    pub mod converge {
        #[path = "E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut/rust/crates/editor-api/src/mv_recipe/converge_plan.rs"]
        mod plan;
        #[path = "E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut/rust/crates/editor-api/src/mv_recipe/converge_transform.rs"]
        mod transform;
        pub(crate) use plan::{Paint, PaintKind, Stop, Style};
        pub(crate) use transform::{Matrix, Operation};
    }
    #[path = "E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/_others/rocut/rust/crates/editor-api/src/mv_recipe/memories.rs"]
    pub mod memories;
}

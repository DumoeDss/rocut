//! Full original scenes/night.js registration `train`, including original post intent.
#[path = "train_art.rs"]
mod art;
#[path = "train_canvas.rs"]
mod canvas;
#[path = "train_draw.rs"]
mod draw;
#[path = "train_fonts.rs"]
mod fonts;
#[path = "train_geometry.rs"]
mod geometry;
#[path = "train_math.rs"]
mod math;
#[path = "train_model.rs"]
mod model;
#[path = "train_producer.rs"]
mod producer;
pub use fonts::{Admission, Stack};
pub use model::{Image, Sample, Settings};
pub use producer::{produce, Plan};

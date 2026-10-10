use serde::Serialize;

pub type Matrix = [f64; 6];
// Canvas rounds each translate/scale input but retains rotate's intermediate
// double matrix. A pre-multiplied setTransform rounds all six coefficients.
#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Operation {
    Translate { offset: [f64; 2] },
    Rotate { radians: f64 },
    Scale { factors: [f64; 2] },
    // Preserve a reference setTransform(other.getTransform()) boundary after
    // replaying the source CTM, before applying destination-local operations.
    CopyTransform,
    CopyScaledTransform { scale: f64, offset: [f64; 2] },
}

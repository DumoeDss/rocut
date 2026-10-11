//! Sky transport adds the original CSS-filtered Milky Way stroke, not a shadow substitute.
use super::plan::{self, Matrix, Operation, Paint, native};
use serde::Serialize;
#[derive(Serialize)]
#[serde(untagged)]
pub enum Command {
    Heart(plan::Command),
    Sky(SkyCommand),
}
#[derive(Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum SkyCommand {
    Surface {
        id: &'static str,
        size: [u32; 2],
        commands: Vec<Command>,
    },
    FilteredPath {
        transform: Matrix,
        operations: Vec<Operation>,
        path: Vec<plan::Step>,
        paints: Vec<Paint>,
        blur_px: f64,
    },
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub commands: Vec<Command>,
    pub raster_budget_bytes: u64,
}
pub fn heart(commands: Vec<plan::Command>) -> Vec<Command> {
    commands.into_iter().map(Command::Heart).collect()
}
pub fn release(id: &'static str) -> Command {
    Command::Heart(plan::Command::Native(native::Command::ReleaseSurface {
        surface: id,
    }))
}

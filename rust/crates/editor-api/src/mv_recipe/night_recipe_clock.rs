use super::{Data, Night};
use serde::Deserialize;
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
enum Beats {
    Manual {
        #[serde(rename = "songTicks")]
        song_ticks: Vec<u64>,
    },
    Analysis,
}
impl Night {
    // Frozen producers intentionally do not export their private Beats enum.
    // This closed transport enum reads the already validated author descriptor.
    pub(super) fn beats(&self, analysis: Option<&Data>) -> Result<Vec<f64>, String> {
        let mode: Beats = serde_json::from_value(self.binding["settings"]["beats"].clone())
            .map_err(|e| e.to_string())?;
        let ticks = match mode {
            Beats::Manual { song_ticks } => song_ticks,
            Beats::Analysis => analysis
                .ok_or("Night requires reviewed whole-song beat analysis")?
                .beats
                .clone(),
        };
        if let Some(data) = analysis {
            data.validate()?;
        }
        if ticks.len() > 8192
            || ticks.windows(2).any(|p| p[0] >= p[1])
            || ticks.iter().any(|n| *n > 2_592_000_000)
        {
            return Err("Night public whole-song beats exceed native owner bounds".into());
        }
        Ok(ticks.iter().map(|n| *n as f64 / 120000.0).collect())
    }
    pub(in crate::mv_recipe) fn uses_audio(&self) -> bool {
        self.binding["settings"]["beats"]["kind"] == "analysis"
    }
}

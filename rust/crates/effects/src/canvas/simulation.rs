use super::{CanvasConfig, CanvasError, CanvasStroke, TICKS_PER_SECOND, validate};

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct CanvasCell {
    pub pigment: [f64; 3],
    pub coverage: f64,
    pub wetness: f64,
    pub height: f64,
}
#[derive(Clone, Debug, PartialEq)]
pub struct CanvasState {
    sampled_ticks: i64,
    pub columns: u32,
    pub rows: u32,
    cells: Vec<CanvasCell>,
    // Exact static numerical identity, not a resource hash or live-video history.
    config: CanvasConfig,
    source_snapshot: Vec<[f64; 4]>,
}
impl CanvasState {
    pub fn sampled_ticks(&self) -> i64 {
        self.sampled_ticks
    }
    pub fn cells(&self) -> &[CanvasCell] {
        &self.cells
    }
    pub(super) fn initialize_admitted(c: &CanvasConfig, source: &[[f64; 4]], sampled: i64) -> Self {
        Self {
            sampled_ticks: sampled,
            columns: c.columns,
            rows: c.rows,
            cells: vec![CanvasCell::default(); source.len()],
            config: *c,
            source_snapshot: source.to_vec(),
        }
    }
    pub(super) fn owned_payload_bytes(&self) -> Option<u64> {
        (self.cells.capacity() as u64)
            .checked_mul(std::mem::size_of::<CanvasCell>() as u64)?
            .checked_add((self.source_snapshot.capacity() as u64).checked_mul(32)?)
    }
    pub(super) fn advance_admitted(
        &mut self,
        strokes: &[CanvasStroke],
        cursor: u64,
        next: u64,
        scratch: &mut [CanvasCell],
    ) {
        for (index, s) in strokes.iter().enumerate() {
            if cursor >= s.start_ticks && cursor < s.end_ticks {
                super::deposition::deposit(
                    &self.config,
                    s,
                    index as u32,
                    cursor,
                    next,
                    &self.source_snapshot,
                    &mut self.cells,
                );
            }
        }
        advance(
            &self.config,
            &self.source_snapshot,
            &self.cells,
            scratch,
            (next - cursor) as f64 / TICKS_PER_SECOND as f64,
        );
        self.cells.copy_from_slice(scratch);
    }
}

pub(super) fn source_valid(c: &CanvasConfig, source: &[[f64; 4]]) -> Result<(), CanvasError> {
    if source.len() != (u64::from(c.columns) * u64::from(c.rows)) as usize {
        return Err(CanvasError(
            "Canvas input must exactly match grid dimensions",
        ));
    }
    if source.iter().any(|p| {
        !p.iter().all(|v| v.is_finite())
            || !(0.0..=1.0).contains(&p[3])
            || p[..3].iter().any(|v| *v < 0.0 || *v > p[3])
    }) {
        return Err(CanvasError(
            "Canvas source must be finite premultiplied linear RGBA",
        ));
    }
    Ok(())
}

/// Authoritative stateless seek. Steps anchored at zero are split at exact
/// authored endpoints and at the target residue; future path never contributes.
pub fn rebuild(
    c: &CanvasConfig,
    strokes: &[CanvasStroke],
    source: &[[f64; 4]],
    local_ticks: i64,
    numerator: u32,
    denominator: u32,
) -> Result<CanvasState, CanvasError> {
    let mut job =
        super::CanvasReplayJob::new(c, strokes, source, local_ticks, numerator, denominator)?;
    job.advance(std::num::NonZeroU64::MAX)?;
    job.finish()
}

pub(super) fn advance(
    c: &CanvasConfig,
    source: &[[f64; 4]],
    old: &[CanvasCell],
    next: &mut [CanvasCell],
    dt: f64,
) {
    next.copy_from_slice(old);
    let nx = c.columns as usize;
    for i in 0..old.len() {
        for j in [
            if i % nx + 1 < nx { Some(i + 1) } else { None },
            if i + nx < old.len() {
                Some(i + nx)
            } else {
                None
            },
        ]
        .into_iter()
        .flatten()
        {
            if source[i][3] == 0.0 || source[j][3] == 0.0 {
                continue;
            }
            // Four neighbours with coefficient <=.2: positive symmetric transport.
            let k = c.diffusion * dt * (old[i].wetness + old[j].wetness) * 0.5;
            for channel in 0..3 {
                let flux = k * (old[j].pigment[channel] - old[i].pigment[channel]);
                next[i].pigment[channel] += flux;
                next[j].pigment[channel] -= flux;
            }
            let flux = k * (old[j].coverage - old[i].coverage);
            next[i].coverage += flux;
            next[j].coverage -= flux;
            let flux = k * (old[j].height - old[i].height);
            next[i].height += flux;
            next[j].height -= flux;
            let flux = k * (old[j].wetness - old[i].wetness);
            next[i].wetness += flux;
            next[j].wetness -= flux;
        }
    }
    let drying = (-c.drying * dt).exp();
    for cell in next {
        cell.wetness *= drying;
    }
}

pub fn shade(
    c: &CanvasConfig,
    state: &CanvasState,
    source: &[[f64; 4]],
) -> Result<Vec<[f64; 4]>, CanvasError> {
    validate_state_source(c, state, source)?;
    Ok(super::lighting::shade(c, state.cells(), source))
}

/// Same material/source/config admission as shade, with no output allocation.
pub(super) fn validate_state_source(
    c: &CanvasConfig,
    state: &CanvasState,
    source: &[[f64; 4]],
) -> Result<(), CanvasError> {
    validate(c, &[])?;
    source_valid(c, source)?;
    if !same_config_bits(c, &state.config)
        || source.len() != state.source_snapshot.len()
        || !source
            .iter()
            .flatten()
            .zip(state.source_snapshot.iter().flatten())
            .all(|(a, b)| a.to_bits() == b.to_bits())
    {
        return Err(CanvasError(
            "Canvas state source or static configuration identity mismatch",
        ));
    }
    if state.columns != c.columns
        || state.rows != c.rows
        || state.cells.len() != source.len()
        || state.cells.iter().any(|p| {
            !p.pigment
                .iter()
                .chain([&p.coverage, &p.wetness, &p.height])
                .all(|v| v.is_finite())
                || p.coverage < -1e-12
                || p.coverage > 1.0 + 1e-12
                || p.wetness < -1e-12
                || p.wetness > 1.0 + 1e-12
                || p.height < -1e-12
                || p.pigment
                    .iter()
                    .any(|v| *v < -1e-12 || *v > p.coverage + 1e-12)
        })
    {
        return Err(CanvasError(
            "Canvas material state shape or invariant invalid",
        ));
    }
    Ok(())
}

fn same_config_bits(a: &CanvasConfig, b: &CanvasConfig) -> bool {
    a.columns == b.columns
        && a.rows == b.rows
        && a.duration_ticks == b.duration_ticks
        && a.seed == b.seed
        && [
            a.drying,
            a.diffusion,
            a.weave_frequency,
            a.weave_height,
            a.light[0],
            a.light[1],
            a.light[2],
            a.relief,
        ]
        .into_iter()
        .zip([
            b.drying,
            b.diffusion,
            b.weave_frequency,
            b.weave_height,
            b.light[0],
            b.light[1],
            b.light[2],
            b.relief,
        ])
        .all(|(a, b)| a.to_bits() == b.to_bits())
}

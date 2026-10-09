//! Known buffer counts plus explicit conservative reservations. Chromium heap,
//! opaque convolution/FFT and engine bookkeeping are not hard memory guarantees.
use super::execution_model::{DecodedSource, PreparedBus, PreparedTrack, WorkingSet};
use crate::programmatic_audio::MAX_PCM_BYTES;

pub(super) fn estimate(
    sources: &[DecodedSource],
    tracks: &[PreparedTrack],
    buses: &[PreparedBus],
    canonical_frames: u64,
    crop_frames: u64,
    encoded_bytes: u64,
) -> Result<WorkingSet, String> {
    let decoded = sources.iter().map(|source| source.pcm_bytes).sum::<u64>();
    if decoded > MAX_PCM_BYTES {
        return Err("HyperFrames complete tempo-adjusted dry-PCM exceeds its budget".into());
    }
    // Full native s16 preparation and explicit graph-rate conversion coexist
    // with retained dry PCM. Byte transport keeps chunks plus its joined copy.
    let rate_preparation_bytes = sources
        .iter()
        .filter_map(|source| {
            source.rate_preparation.as_ref().map(|recipe| {
                recipe.stereo_filter.len() as u64
                    + recipe.mono_filter.len() as u64
                    + recipe.resample_filter.len() as u64
            })
        })
        .sum::<u64>()
        + sources
            .iter()
            .filter_map(|source| {
                source.rate_preparation.as_ref().map(|recipe| {
                    2 * recipe.native_max_bytes
                        + 2 * source.pcm_bytes
                        + recipe.clock_cells as u64 * 16
                })
            })
            .max()
            .unwrap_or(0);
    let mixes = canonical_frames * 8 * (buses.len() as u64 + 1);
    // Deliberately include muted/hidden stages: a mute or tiny final crop must
    // not turn an otherwise excessive full-history graph into an admitted one.
    let retained_tracks = tracks
        .iter()
        .map(|track| track.fx_stage.max_output_bytes)
        .sum::<u64>();
    let retained_buses = buses
        .iter()
        .map(|bus| bus.fx_stage.max_output_bytes)
        .sum::<u64>();
    let master_input = retained_buses
        + tracks
            .iter()
            .filter(|track| track.resolved_bus_instance_id.is_none())
            .map(|track| track.fx_stage.max_output_bytes)
            .sum::<u64>();
    let mut assembly_input = master_input;
    for bus in buses {
        let input = tracks
            .iter()
            .filter(|track| track.resolved_bus_instance_id.as_deref() == Some(&bus.instance_id))
            .map(|track| track.fx_stage.max_output_bytes)
            .sum::<u64>();
        assembly_input = assembly_input.max(input);
    }
    if assembly_input > MAX_PCM_BYTES {
        return Err("HyperFrames canonical assembly input exceeds the PCM envelope budget".into());
    }
    let mut largest_transport = 0;
    let mut largest_native_reserve = 0;
    let mut largest_explicit_native = 0;
    let mut largest_nominal_history = 0;
    let mut automation_bytes = 0;
    for stage in tracks
        .iter()
        .map(|track| &track.fx_stage)
        .chain(buses.iter().map(|bus| &bus.fx_stage))
    {
        // Native scheduling allocates Float32 curves; reserve three copies
        // across JS/native transport plus bounded point/event bookkeeping.
        // Sum all stages conservatively even though native targets are serial.
        automation_bytes += stage.automation_curve_values as u64 * 4 * 3
            + stage.automation_points as u64 * 256
            + stage.automation_scheduled_events as u64 * 256;
        let input = stage.input_frames * 8;
        let output = stage.expected_output_frames * 8;
        // Host input+snapshot, browser staging+planar+AudioBuffer, host output,
        // context output and native returned copy; bounded base64 chunk scratch.
        largest_transport = largest_transport.max(5 * input + 3 * output + 2 * 1024 * 1024);
        let mut explicit = 0;
        let mut nominal_history = 0;
        let mut enabled = 0;
        let sr = u64::from(stage.sample_rate);
        for node in stage
            .normalized_fx_chain
            .nodes
            .iter()
            .filter(|node| node.enabled)
        {
            enabled += 1;
            // Pinned native JS allocations only, not opaque WebAudio storage.
            explicit += match node.kind {
                "reverb" => {
                    8 * (f64::from(stage.sample_rate)
                        * (0.6 + node.number("size").unwrap_or(0.0) * 2.6))
                        .floor()
                        .max(1.0) as u64
                }
                "saturate" => 8192 * 4,
                "chorus" | "phaser" => 4 * sr,
                "pitchshift" => 16 * (f64::from(stage.sample_rate) * 0.1).round() as u64,
                _ => 0,
            };
            // createDelay(maxDelayTime), independent of its current knob; ring
            // padding/quantum and internal copies are covered only by reserve.
            nominal_history += match node.kind {
                "delay" => 5 * sr * 8,
                "chorus" => sr * 4,
                _ => 0,
            };
        }
        largest_explicit_native = largest_explicit_native.max(explicit);
        largest_nominal_history = largest_nominal_history.max(nominal_history);
        // Policy reservation for convolution/FFT, WaveShaper internal copies,
        // worklet/VM/node state. Not a source-proven or process RSS hard bound.
        // Sequential fresh targets are required; do not overlap native stages.
        largest_native_reserve =
            largest_native_reserve.max(16 * 1024 * 1024 + enabled * 4 * 1024 * 1024);
    }
    let curve_bytes = buses
        .iter()
        .flat_map(|bus| &bus.fader.events)
        .map(|event| match event {
            super::bus_schedule::Event::Curve { values, .. } => values.len() as u64 * 4,
            _ => 0,
        })
        .sum::<u64>();
    // Account separately for binary WASM envelope/input/output copies used by
    // dry/gain kernels, not only the later native FX transport stage.
    let largest_track = tracks
        .iter()
        .map(|track| track.fx_stage.expected_output_frames * 8)
        .max()
        .unwrap_or(0);
    // Full decoded source already persists above. Dry preparation additionally
    // packs it into a host binary envelope and copies that envelope into WASM.
    let kernel_scratch = (2 * decoded + largest_track * 3)
        .max(2 * assembly_input + canonical_frames * 8 * 2)
        + 8 * 1024 * 1024;
    // Caller-owned encoded bytes stay alive while the host keeps its immutable
    // Buffer.from snapshot for identity verification and decoding.
    let known = 2 * encoded_bytes
        + rate_preparation_bytes
        + decoded
        + mixes
        + crop_frames * 8
        + curve_bytes
        + automation_bytes
        + largest_explicit_native
        + retained_tracks
        + retained_buses
        + largest_transport.max(kernel_scratch);
    let peak = known + largest_native_reserve + largest_nominal_history;
    let limit = 512 * 1024 * 1024;
    if peak > limit {
        return Err(
            "HyperFrames executor exceeds its conservative 512 MiB working-set estimate".into(),
        );
    }
    Ok(WorkingSet {
        limit_bytes: limit,
        known_buffer_bytes: known,
        estimated_native_reserve_bytes: largest_native_reserve,
        estimated_peak_bytes: peak,
        decoded_pcm_bytes: decoded,
        rate_preparation_bytes,
        canonical_mix_bytes: mixes,
        largest_stage_transport_bytes: largest_transport,
        explicit_native_buffer_bytes: largest_explicit_native,
        nominal_native_history_bytes: largest_nominal_history,
        retained_track_fx_bytes: retained_tracks,
        retained_bus_fx_bytes: retained_buses,
        largest_assembly_input_bytes: assembly_input,
        automation_buffer_bytes: automation_bytes,
        browser_total_memory_guaranteed: false,
    })
}

use super::{FrameRate, SAFE, gcd, positive};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct VideoPackets {
    timebase: u64,
    timestamps_seconds: Vec<f64>,
    durations_seconds: Vec<f64>,
    complete: bool,
}

fn ticks(seconds: f64, timebase: u64) -> Option<i64> {
    let value = seconds * timebase as f64;
    let rounded = value.round();
    (value.is_finite() && rounded.abs() <= SAFE as f64 && (value - rounded).abs() < 0.000_001)
        .then_some(rounded as i64)
}

pub(super) fn inspect(input: VideoPackets) -> Option<FrameRate> {
    let count = input.timestamps_seconds.len();
    if !positive(input.timebase)
        || count == 0
        || count > 256
        || input.durations_seconds.len() != count
    {
        return None;
    }
    let mut packets = Vec::with_capacity(count);
    for (timestamp, duration) in input
        .timestamps_seconds
        .into_iter()
        .zip(input.durations_seconds)
    {
        let timestamp = ticks(timestamp, input.timebase)?;
        let duration = ticks(duration, input.timebase)?;
        if duration <= 0 {
            return None;
        }
        packets.push((timestamp, duration as u64));
    }
    packets.sort_unstable_by_key(|packet| packet.0);
    if input.complete
        && packets
            .windows(2)
            .any(|pair| pair[1].0.checked_sub(pair[0].0) != Some(pair[0].1 as i64))
    {
        return None;
    }
    let duration = packets
        .iter()
        .try_fold(0_u64, |sum, packet| sum.checked_add(packet.1))?;
    if !positive(duration) {
        return None;
    }
    let numerator = (count as u64).checked_mul(input.timebase)?;
    let divisor = gcd(numerator, duration);
    let numerator = numerator / divisor;
    let denominator = duration / divisor;
    if !positive(numerator) || !positive(denominator) {
        return None;
    }
    let mode = if !input.complete {
        "average"
    } else if packets.iter().all(|packet| packet.1 == packets[0].1) {
        "constant"
    } else {
        "variable"
    };
    Some(FrameRate {
        numerator,
        denominator,
        mode: mode.into(),
        samples: count as u64,
        complete: input.complete,
    })
}

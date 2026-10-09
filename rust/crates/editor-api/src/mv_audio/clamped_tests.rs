use super::super::{Channel, Data, Signal};
use serde_json::json;

fn measured() -> Data {
    let data: Data = serde_json::from_value(json!({
        "schema": "rocut-mv-audio/1",
        "provenance": {
            "schema": "creator-mv-audio/1", "inputSha256": "a".repeat(64),
            "manifestSha256": "b".repeat(64), "musicSha256": "c".repeat(64),
            "envelopesSha256": "d".repeat(64),
            "review": {"status": "accepted", "reference": "clamped sampler fixture"}
        },
        "duration": 2, "fps": 4, "beats": [0, 60000, 150000], "downbeats": [0],
        "channels": {
            "mix_rms": [0.2, 0.8, 0.1, 0.7, 0.3, 0.6, 0.4, 0.9],
            "low_power": vec![0.1; 8], "mid_power": vec![0.2; 8],
            "high_power": vec![0.3; 8]
        },
        "scales": {"mix_rms": 1, "low_power": 1, "mid_power": 1, "high_power": 1}
    }))
    .unwrap();
    data.validate().unwrap();
    data
}

#[test]
fn clamps_both_endpoints_without_silence_or_extrapolation() {
    let data = measured();
    for (seconds, expected) in [
        (-f64::MAX, 0.2),
        (-0.125, 0.2),
        (0.0, 0.2),
        (0.25, 0.8),
        (1.5, 0.4),
        (1.75, 0.9),
        (1.875, 0.9),
        (2.0, 0.9),
        (f64::MAX, 0.9),
    ] {
        assert_eq!(
            data.sample_envelope_clamped(Channel::MixRms, seconds)
                .unwrap(),
            expected,
            "source_seconds={seconds}"
        );
    }
}

#[test]
fn interpolates_floating_source_seconds_without_tick_rounding() {
    let data = measured();
    for (seconds, expected) in [(0.125, 0.5), (0.125001, 0.5000024), (1.625, 0.65)] {
        let actual = data
            .sample_envelope_clamped(Channel::MixRms, seconds)
            .unwrap();
        assert!((actual - expected).abs() < 1e-12);
    }
}

#[test]
fn rejects_missing_empty_channels_and_nonfinite_time() {
    let mut data = measured();
    assert!(
        data.sample_envelope_clamped(Channel::VocalRms, 0.0)
            .is_err()
    );
    for seconds in [f64::NAN, f64::NEG_INFINITY, f64::INFINITY] {
        assert!(
            data.sample_envelope_clamped(Channel::MixRms, seconds)
                .is_err()
        );
    }
    data.channels.get_mut(&Channel::MixRms).unwrap().clear();
    assert!(data.sample_envelope_clamped(Channel::MixRms, 0.0).is_err());
}

#[test]
fn leaves_signal_missing_policies_tick_rounding_and_real_intervals_unchanged() {
    let data = measured();
    for missing in ["zero", "error"] {
        let signal: Signal = serde_json::from_value(json!({
            "kind": "envelope", "channel": "mix_rms", "clock": "source", "missing": missing
        }))
        .unwrap();
        for source in [-0.125, 2.0, 3.0] {
            let actual = signal.sample(Some(&data), 0.0, source);
            if missing == "zero" {
                assert_eq!(actual.unwrap(), 0.0);
            } else {
                assert!(actual.is_err());
            }
        }
        assert!((signal.sample(Some(&data), 0.0, 0.125001).unwrap() - 0.5).abs() < 1e-12);
        let pulse: Signal = serde_json::from_value(json!({
            "kind": "beatPulse", "decay": 2, "clock": "source", "missing": missing
        }))
        .unwrap();
        assert!((pulse.sample(Some(&data), 0.0, 0.875).unwrap() - (-1.0_f64).exp()).abs() < 1e-12);
        let after_last = pulse.sample(Some(&data), 0.0, 1.5);
        if missing == "zero" {
            assert_eq!(after_last.unwrap(), 0.0);
        } else {
            assert!(after_last.is_err());
        }
    }
}

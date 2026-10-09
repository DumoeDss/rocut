//! Parameter contract ported from @hyperframes/core 0.8.139 dist/audioFx.js.
//! See NOTICE for the upstream Apache-2.0 attribution. UI steps are deliberately
//! not applied: the native normalizer clamps but does not quantize parameters.
use super::fx_model::{Definition, Parameter};

macro_rules! number {
    ($key:literal, $min:expr, $max:expr, $default:expr, $automatable:literal) => {
        Parameter::Number {
            key: $key,
            min: $min,
            max: $max,
            default: $default,
            automatable: $automatable,
        }
    };
}

const POLES: Parameter = Parameter::Enum {
    key: "poles",
    options: &["1", "2"],
    default: "2",
};

pub(super) const DEFINITIONS: &[Definition] = &[
    Definition {
        id: "gain",
        web: "gain-node",
        params: &[number!("gain", -60.0, 12.0, 0.0, true)],
    },
    Definition {
        id: "peaking",
        web: "biquad-peaking",
        params: &[
            number!("frequency", 20.0, 20000.0, 1000.0, true),
            number!("gain", -40.0, 40.0, 0.0, true),
            number!("q", 0.1, 20.0, 1.0, true),
        ],
    },
    Definition {
        id: "lowshelf",
        web: "biquad-lowshelf",
        params: &[
            number!("frequency", 20.0, 2000.0, 200.0, true),
            number!("gain", -40.0, 40.0, 0.0, true),
        ],
    },
    Definition {
        id: "highshelf",
        web: "biquad-highshelf",
        params: &[
            number!("frequency", 500.0, 20000.0, 4000.0, true),
            number!("gain", -40.0, 40.0, 0.0, true),
        ],
    },
    Definition {
        id: "highpass",
        web: "biquad-highpass",
        params: &[
            number!("frequency", 20.0, 20000.0, 300.0, true),
            number!("q", 0.1, 20.0, 0.707, true),
            POLES,
        ],
    },
    Definition {
        id: "lowpass",
        web: "biquad-lowpass",
        params: &[
            number!("frequency", 100.0, 20000.0, 8000.0, true),
            number!("q", 0.1, 20.0, 0.707, true),
            POLES,
        ],
    },
    Definition {
        id: "compressor",
        web: "worklet-compressor",
        params: &[
            number!("threshold", -60.0, 0.0, -24.0, false),
            number!("ratio", 1.0, 20.0, 4.0, false),
            number!("attack", 0.01, 2000.0, 20.0, false),
            number!("release", 0.01, 9000.0, 250.0, false),
            number!("knee", 1.0, 8.0, 2.83, false),
            number!("makeup", 0.0, 36.0, 0.0, false),
            number!("mix", 0.0, 1.0, 1.0, false),
        ],
    },
    Definition {
        id: "limiter",
        web: "worklet-limiter",
        params: &[
            number!("limit", -24.0, 0.0, -1.0, false),
            number!("attack", 0.1, 80.0, 5.0, false),
            number!("release", 1.0, 8000.0, 50.0, false),
            number!("level_out", -24.0, 24.0, 0.0, false),
        ],
    },
    Definition {
        id: "gate",
        web: "worklet-gate",
        params: &[
            number!("threshold", -80.0, 0.0, -35.0, false),
            number!("range", -80.0, 0.0, -24.0, false),
            number!("ratio", 1.0, 20.0, 10.0, false),
            number!("attack", 0.01, 9000.0, 1.0, false),
            number!("release", 0.01, 9000.0, 100.0, false),
            number!("knee", 1.0, 8.0, 2.83, false),
        ],
    },
    Definition {
        id: "saturate",
        web: "waveshaper",
        params: &[
            Parameter::Enum {
                key: "type",
                options: &[
                    "tanh", "atan", "cubic", "exp", "alg", "quintic", "sin", "erf", "hard",
                ],
                default: "tanh",
            },
            number!("threshold", -40.0, 0.0, -6.0, false),
            number!("output", -24.0, 24.0, 0.0, true),
            number!("oversample", 1.0, 8.0, 4.0, false),
        ],
    },
    Definition {
        id: "bitcrush",
        web: "worklet-bitcrush",
        params: &[
            number!("bits", 1.0, 32.0, 8.0, false),
            number!("samples", 1.0, 250.0, 1.0, false),
            number!("mix", 0.0, 1.0, 1.0, false),
        ],
    },
    Definition {
        id: "pitchshift",
        web: "worklet-pitchshift",
        params: &[
            number!("semitones", -12.0, 12.0, 0.0, false),
            number!("mix", 0.0, 1.0, 1.0, false),
        ],
    },
    Definition {
        id: "delay",
        web: "delay-feedback",
        params: &[
            number!("time", 1.0, 5000.0, 250.0, true),
            number!("feedback", 0.01, 0.95, 0.35, true),
            number!("mix", 0.0, 1.0, 0.4, true),
        ],
    },
    Definition {
        id: "chorus",
        web: "chorus-lfo",
        params: &[
            number!("delay", 1.0, 100.0, 7.0, true),
            number!("depth", 0.0, 10.0, 2.0, true),
            number!("speed", 0.01, 10.0, 1.0, true),
            number!("mix", 0.0, 1.0, 0.5, true),
        ],
    },
    Definition {
        id: "phaser",
        web: "allpass-phaser",
        params: &[
            number!("in_gain", 0.0, 1.0, 0.4, true),
            number!("out_gain", 0.0, 2.0, 0.74, true),
            number!("delay", 0.1, 5.0, 3.0, false),
            number!("decay", 0.0, 0.99, 0.4, false),
            number!("speed", 0.1, 2.0, 0.5, true),
            Parameter::Enum {
                key: "type",
                options: &["0", "1"],
                default: "0",
            },
        ],
    },
    Definition {
        id: "reverb",
        web: "convolver",
        params: &[
            number!("size", 0.05, 1.0, 0.7, false),
            number!("damping", 0.0, 1.0, 0.5, false),
            number!("wet", 0.0, 1.0, 0.35, true),
            number!("dry", 0.0, 1.0, 0.7, true),
        ],
    },
];

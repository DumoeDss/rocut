use time::FrameRate;

// Input-selection budgets from https://www.webmproject.org/vp9/levels/.
// That table describes P0/P2 4:2:0; reuse its numeric limits conservatively for
// P1 input selection, not as proof of encoded-bitstream or decoder conformance.
// Actual padding, alt-ref samples, CPB, tiles and references are encoder concerns.
// Columns: level, luma samples/second, picture samples, bits/second, max axis.
const LEVELS: &[(u8, u64, u32, u32, u32)] = &[
    (10, 829_440, 36_864, 200_000, 512),
    (11, 2_764_800, 73_728, 800_000, 768),
    (20, 4_608_000, 122_880, 1_800_000, 960),
    (21, 9_216_000, 245_760, 3_600_000, 1344),
    (30, 20_736_000, 552_960, 7_200_000, 2048),
    (31, 36_864_000, 983_040, 12_000_000, 2752),
    (40, 83_558_400, 2_228_224, 18_000_000, 4160),
    (41, 160_432_128, 2_228_224, 30_000_000, 4160),
    (50, 311_951_360, 8_912_896, 60_000_000, 8384),
    (51, 588_251_136, 8_912_896, 120_000_000, 8384),
    (52, 1_176_502_272, 8_912_896, 180_000_000, 8384),
    (60, 1_176_502_272, 35_651_584, 180_000_000, 16832),
    (61, 2_353_004_544, 35_651_584, 240_000_000, 16832),
    (62, 4_706_009_088, 35_651_584, 480_000_000, 16832),
];

fn level(width: u32, height: u32, frame_rate: FrameRate, bitrate: u32) -> Option<u8> {
    let pixels = u128::from(width) * u128::from(height);
    let samples = pixels * u128::from(frame_rate.numerator);
    LEVELS
        .iter()
        .find(|&&(_, sample_rate, picture_size, max_bitrate, max_axis)| {
            width <= max_axis
                && height <= max_axis
                && pixels <= u128::from(picture_size)
                && bitrate <= max_bitrate
                && samples <= u128::from(sample_rate) * u128::from(frame_rate.denominator)
        })
        .map(|&(level, ..)| level)
}

pub(super) fn full_codec_string(
    width: u32,
    height: u32,
    frame_rate: FrameRate,
    bitrate: u32,
) -> Result<String, &'static str> {
    let level = level(width, height, frame_rate, bitrate)
        .ok_or("4:4:4 export exceeds supported VP9 input level limits")?;
    // https://www.webmproject.org/vp9/mp4/: P1, 8-bit, 4:4:4,
    // BT.709 primaries, sRGB transfer, BT.709 matrix, full range.
    Ok(format!("vp09.01.{level:02}.08.03.01.13.01.01"))
}

pub(super) fn quantizer_codec_string(
    width: u32,
    height: u32,
    frame_rate: FrameRate,
    bitrate: u32,
    high_chroma: bool,
) -> Result<String, &'static str> {
    let level = level(width, height, frame_rate, bitrate)
        .ok_or("Quantizer export exceeds supported VP9 input level limits")?;
    // This is input selection, not a promise that q-controlled packets meet
    // the level's bitrate/CPB limits. The native output still requires evidence.
    let (profile, chroma) = if high_chroma { (1, 3) } else { (0, 1) };
    Ok(format!(
        "vp09.{profile:02}.{level:02}.08.{chroma:02}.01.13.01.01"
    ))
}

#[cfg(test)]
mod tests {
    use super::level;
    use time::FrameRate;

    #[test]
    fn each_input_limit_can_require_a_higher_level() {
        let fps = FrameRate::new(1, 1);
        assert_eq!(level(192, 128, fps, 200_000), Some(10));
        assert_eq!(level(192, 128, fps, 200_001), Some(11));
        assert_eq!(level(192, 192, fps, 1), Some(10));
        assert_eq!(level(193, 192, fps, 1), Some(11));
        assert_eq!(level(512, 1, fps, 1), Some(10));
        assert_eq!(level(513, 1, fps, 1), Some(11));
        assert_eq!(level(1, 513, fps, 1), Some(11));
    }

    #[test]
    fn sample_rate_comparison_retains_rational_precision() {
        assert_eq!(level(192, 144, FrameRate::new(30, 1), 1), Some(10));
        assert_eq!(level(192, 144, FrameRate::new(30_000, 1001), 1), Some(10));
        assert_eq!(level(192, 144, FrameRate::new(120_000, 3999), 1), Some(11));
        assert_eq!(
            level(192, 144, FrameRate::new(4_294_967_280, 143_165_576), 1),
            Some(10)
        );
    }

    #[test]
    fn exceeding_any_maximum_is_rejected_without_level_fallback() {
        let fps = FrameRate::new(1, 1);
        assert_eq!(level(16_832, 1, fps, 480_000_000), Some(62));
        assert_eq!(level(16_833, 1, fps, 1), None);
        assert_eq!(level(1, 16_833, fps, 1), None);
        assert_eq!(level(8192, 4352, fps, 1), Some(60));
        assert_eq!(level(8192, 4353, fps, 1), None);
        assert_eq!(level(1, 1, fps, 480_000_001), None);
        assert_eq!(level(8192, 4352, FrameRate::new(132, 1), 1), Some(62));
        assert_eq!(level(8192, 4352, FrameRate::new(133, 1), 1), None);
        assert_eq!(
            level(u32::MAX, u32::MAX, FrameRate::new(u32::MAX, 1), 1),
            None
        );
    }
}

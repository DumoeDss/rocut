use super::Args;
pub(in crate::mv_recipe) fn scratch_pixels(
    args: &Args,
    images: Option<&crate::mv_image_dimensions::Context>,
) -> Result<u64, String> {
    let mut tint = 0u64;
    if let Some(images) = images {
        for cut in &args.cuts {
            if cut.disable_rim || args.disable_rim {
                continue;
            }
            if let Some(ch) = &cut.character {
                let i = images.image(&ch.image)?;
                tint = tint.max(u64::from(i.width) * u64::from(i.height));
            }
        }
    }
    (1920u64 * 1080)
        .checked_add(tint)
        .ok_or_else(|| "Burst scratch residency overflow".into())
}
pub(in crate::mv_recipe) fn expanded_work(args: &Args) -> u32 {
    args.cuts
        .iter()
        .map(|cut| {
            let lamps = cut
                .lamps
                .as_ref()
                .map_or(0, |l| (l.a.len() + l.b.len()) as u32 * 3);
            let character = cut.character.as_ref().map_or(0, |ch| {
                let strips = if ch.disable_wave || ch.wave.as_ref().is_some_and(|w| w.amp == 0.0) {
                    1
                } else {
                    90
                };
                strips
                    * if cut.disable_rim || args.disable_rim {
                        1
                    } else {
                        2
                    }
                    + 4
            });
            32 + lamps
                + character
                + cut.tint.len() as u32
                + if args.speed.unwrap_or(true) { 88 } else { 0 }
        })
        .max()
        .unwrap_or(32)
}
// Fixed admitted ceiling, enforced against serialization before publishing.
// Includes native gradient/path JSON, strips and resource identifiers. It is a
// host transport policy, never supplied by authored settings.
pub(in crate::mv_recipe) fn plan_bytes_bound(_args: &Args) -> u64 {
    512 * 1024
}

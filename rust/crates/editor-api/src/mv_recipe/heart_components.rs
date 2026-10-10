//! Original Heart alpha-component preparation. Rendering/resampling remains native Canvas.
//! This module is not a scene producer and does not claim four-mode scene parity.

#[derive(Debug, PartialEq)]
pub enum Error {
    InvalidDimensions,
    InvalidPixels,
    BudgetExceeded,
    EmptyHeart,
}

#[derive(Debug)]
pub struct Component {
    pub label: usize,
    pub count: usize,
    pub bounds: [usize; 4],
}

#[derive(Debug)]
pub struct Chip {
    pub label: usize,
    pub width: usize,
    pub height: usize,
    pub rgba: Vec<u8>,
    pub display_size: [usize; 2],
    pub center: [f64; 2],
}

#[derive(Debug)]
pub struct Prepared {
    pub width: usize,
    pub height: usize,
    pub scale: f64,
    pub display_size: [usize; 2],
    pub labels: Vec<Option<usize>>,
    pub components: Vec<Component>,
    pub main: usize,
    pub body_rgba: Vec<u8>,
    pub chips: Vec<Chip>,
    pub top: Vec<[f64; 2]>,
}

/// Discovery is private to Rust preparation; it contains no derived image bytes.
pub struct Discovery {
    width: usize,
    height: usize,
    labels: Vec<Option<usize>>,
    components: Vec<Component>,
    main: usize,
    charge: usize,
}
impl Discovery {
    pub fn parts(&self) -> usize {
        1 + self
            .components
            .iter()
            .filter(|c| c.label != self.main && c.count >= 50)
            .count()
    }
}

impl Prepared {
    /// JS Math.round semantics (including negative half coordinates).
    pub fn alpha_at(&self, x: f64, y: f64) -> u8 {
        if !x.is_finite() || !y.is_finite() {
            return 0;
        }
        let u = (x / self.scale + 0.5).floor();
        let v = (y / self.scale + 0.5).floor();
        if u < 0.0 || v < 0.0 || u >= self.width as f64 || v >= self.height as f64 {
            return 0;
        }
        let q = v as usize * self.width + u as usize;
        if self.labels[q] == Some(self.main) {
            self.body_rgba[q * 4 + 3]
        } else {
            0
        }
    }
}

/// Caller supplies a session byte ceiling covering all allocations in this function.
/// Native decoded/encoded buffers outside this function must be charged separately.
pub fn discover(
    width: usize,
    height: usize,
    rgba: &[u8],
    max_bytes: usize,
) -> Result<Discovery, Error> {
    discover_with_metadata(width, height, rgba, max_bytes, 0)
}
pub fn discover_with_metadata(
    width: usize,
    height: usize,
    rgba: &[u8],
    max_bytes: usize,
    per_part: usize,
) -> Result<Discovery, Error> {
    if width == 0 || height == 0 {
        return Err(Error::InvalidDimensions);
    }
    let n = width.checked_mul(height).ok_or(Error::BudgetExceeded)?;
    let bytes = n.checked_mul(4).ok_or(Error::BudgetExceeded)?;
    if rgba.len() != bytes {
        return Err(Error::InvalidPixels);
    }
    // Discovery labels and stack are exact-sized. Component growth is admitted
    // before allocation, including simultaneous old/new vector storage.
    let per_pixel = std::mem::size_of::<Option<usize>>() + std::mem::size_of::<usize>();
    let mut charge = n
        .checked_mul(per_pixel)
        .and_then(|v| v.checked_add(14 * 16))
        .ok_or(Error::BudgetExceeded)?;
    if charge > max_bytes {
        return Err(Error::BudgetExceeded);
    }
    let mut labels = vec![None; n];
    let mut stack = Vec::with_capacity(n);
    let mut components: Vec<Component> = Vec::new();
    let mut metadata_charge = per_part;
    let mut qualifying = 0usize;
    for p0 in 0..n {
        if labels[p0].is_some() || rgba[p0 * 4 + 3] < 32 {
            continue;
        }
        let label = components.len();
        let mut count = 0;
        let mut bounds = [width, height, 0, 0];
        labels[p0] = Some(label);
        stack.push(p0);
        while let Some(q) = stack.pop() {
            let x = q % width;
            let y = q / width;
            count += 1;
            bounds[0] = bounds[0].min(x);
            bounds[1] = bounds[1].min(y);
            bounds[2] = bounds[2].max(x);
            bounds[3] = bounds[3].max(y);
            let neighbors = [
                if x > 0 { Some(q - 1) } else { None },
                if x + 1 < width { Some(q + 1) } else { None },
                if y > 0 { Some(q - width) } else { None },
                if y + 1 < height {
                    Some(q + width)
                } else {
                    None
                },
            ];
            for next in neighbors.into_iter().flatten() {
                if labels[next].is_none() && rgba[next * 4 + 3] >= 32 {
                    labels[next] = Some(label);
                    stack.push(next);
                }
            }
        }
        if components.len() == components.capacity() {
            let old = components.capacity();
            let next = old.checked_mul(2).unwrap_or(usize::MAX).max(1).min(n);
            let cost = next
                .checked_mul(std::mem::size_of::<Component>())
                .ok_or(Error::BudgetExceeded)?;
            if charge
                .checked_add(cost)
                .and_then(|v| v.checked_add(metadata_charge))
                .ok_or(Error::BudgetExceeded)?
                > max_bytes
            {
                return Err(Error::BudgetExceeded);
            }
            components
                .try_reserve_exact(next - old)
                .map_err(|_| Error::BudgetExceeded)?;
            charge = charge
                .checked_sub(old * std::mem::size_of::<Component>())
                .and_then(|v| {
                    v.checked_add(components.capacity() * std::mem::size_of::<Component>())
                })
                .ok_or(Error::BudgetExceeded)?;
            if charge > max_bytes {
                return Err(Error::BudgetExceeded);
            }
        }
        if count >= 50 {
            // Every qualifying component except the eventual main is a chip;
            // max(1, qualifying) is therefore the exact published-part count.
            qualifying += 1;
            metadata_charge = qualifying
                .checked_mul(per_part)
                .ok_or(Error::BudgetExceeded)?;
            if charge
                .checked_add(metadata_charge)
                .ok_or(Error::BudgetExceeded)?
                > max_bytes
            {
                return Err(Error::BudgetExceeded);
            }
        }
        components.push(Component {
            label,
            count,
            bounds,
        });
    }
    let mut main = 0;
    if components.is_empty() {
        return Err(Error::EmptyHeart);
    }
    for index in 1..components.len() {
        if components[index].count > components[main].count {
            main = index;
        }
    }
    // Stack is no longer live during body/crop preparation.
    charge -= stack.capacity() * std::mem::size_of::<usize>();
    drop(stack);
    Ok(Discovery {
        width,
        height,
        labels,
        components,
        main,
        charge,
    })
}

pub fn finish(discovery: Discovery, rgba: &[u8], max_bytes: usize) -> Result<Prepared, Error> {
    let parts = discovery.parts();
    let Discovery {
        width,
        height,
        labels,
        components,
        main,
        mut charge,
    } = discovery;
    let bytes = width
        .checked_mul(height)
        .and_then(|n| n.checked_mul(4))
        .ok_or(Error::BudgetExceeded)?;
    if rgba.len() != bytes {
        return Err(Error::InvalidPixels);
    }
    charge = charge
        .checked_add(bytes.checked_mul(3).ok_or(Error::BudgetExceeded)?)
        .and_then(|v| v.checked_add((parts - 1).checked_mul(std::mem::size_of::<Chip>())?))
        .ok_or(Error::BudgetExceeded)?;
    // Admit all crops before allocating body or any derived raster.
    for component in &components {
        if component.label == main || component.count < 50 {
            continue;
        }
        let [x0, y0, x1, y1] = component.bounds;
        let crop = (x1 - x0 + 5)
            .checked_mul(y1 - y0 + 5)
            .and_then(|v| v.checked_mul(12))
            .ok_or(Error::BudgetExceeded)?;
        charge = charge.checked_add(crop).ok_or(Error::BudgetExceeded)?;
    }
    if charge > max_bytes {
        return Err(Error::BudgetExceeded);
    }
    let mut body_rgba = rgba.to_vec();
    for (p, label) in labels.iter().enumerate() {
        if label.is_some() && *label != Some(main) {
            body_rgba[p * 4 + 3] = 0;
        }
    }
    let scale = 610.0 / height as f64;
    let display_size = [(width as f64 * scale + 0.5).floor() as usize, 610];
    let mut chips = Vec::with_capacity(parts - 1);
    for component in &components {
        if component.label == main || component.count < 50 {
            continue;
        }
        let [x0, y0, x1, y1] = component.bounds;
        let pw = x1 - x0 + 5;
        let ph = y1 - y0 + 5;
        let crop_bytes = pw
            .checked_mul(ph)
            .and_then(|v| v.checked_mul(4))
            .ok_or(Error::BudgetExceeded)?;
        let mut crop = vec![0; crop_bytes];
        for yy in 0..ph {
            for xx in 0..pw {
                let sx = x0 as i128 - 2 + xx as i128;
                let sy = y0 as i128 - 2 + yy as i128;
                if sx < 0 || sy < 0 || sx >= width as i128 || sy >= height as i128 {
                    continue;
                }
                let q = sy as usize * width + sx as usize;
                if labels[q] == Some(component.label) {
                    let dest = (yy * pw + xx) * 4;
                    crop[dest..dest + 4].copy_from_slice(&rgba[q * 4..q * 4 + 4]);
                }
            }
        }
        chips.push(Chip {
            label: component.label,
            width: pw,
            height: ph,
            rgba: crop,
            display_size: [
                ((pw as f64 * scale + 0.5).floor() as usize).max(2),
                ((ph as f64 * scale + 0.5).floor() as usize).max(2),
            ],
            center: [
                (x0 as f64 - 2.0 + pw as f64 / 2.0) * scale,
                (y0 as f64 - 2.0 + ph as f64 / 2.0) * scale,
            ],
        });
    }
    let mut result = Prepared {
        width,
        height,
        scale,
        display_size,
        labels,
        components,
        main,
        body_rgba,
        chips,
        top: Vec::with_capacity(14),
    };
    for k in 0..14 {
        let x = display_size[0] as f64 * (0.1 + 0.8 * (k as f64 + 0.5) / 14.0);
        for y in (0..display_size[1]).step_by(3) {
            if result.alpha_at(x, y as f64) > 120 {
                result.top.push([x, y as f64 + 8.0]);
                break;
            }
        }
    }
    Ok(result)
}

pub fn prepare(
    width: usize,
    height: usize,
    rgba: &[u8],
    max_bytes: usize,
) -> Result<Prepared, Error> {
    finish(discover(width, height, rgba, max_bytes)?, rgba, max_bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn actual_parts_and_two_phase_budget_fail_closed() {
        let rgba = vec![255; 100 * 100 * 4];
        let discovery = discover_with_metadata(100, 100, &rgba, 1_000_000, 16 * 1024).unwrap();
        assert_eq!(discovery.parts(), 1);
        assert_eq!(discovery.components.capacity(), 1);
        assert_eq!(
            finish(discovery, &rgba, 1).unwrap_err(),
            Error::BudgetExceeded
        );
        // Twenty independent >=50-pixel stripes: reject metadata in discovery,
        // before allocating body, crops, fracture or image descriptors.
        let mut fragmented = vec![0; 50 * 40 * 4];
        for y in (0..40).step_by(2) {
            for x in 0..50 {
                fragmented[(y * 50 + x) * 4 + 3] = 255;
            }
        }
        assert!(matches!(
            discover_with_metadata(50, 40, &fragmented, 200_000, 16 * 1024),
            Err(Error::BudgetExceeded)
        ));
    }

    #[test]
    fn threshold_connectivity_tie_and_ghost_pixels() {
        let mut rgba = vec![7; 3 * 3 * 4];
        for p in 0..9 {
            rgba[p * 4 + 3] = 0;
        }
        rgba[3] = 32;
        rgba[4 * 4 + 3] = 255; // Diagonal does not connect; earliest tie wins.
        rgba[8 * 4 + 3] = 31; // Unlabelled ghost survives body masking.
        let p = prepare(3, 3, &rgba, 100_000).unwrap();
        assert_eq!(p.main, 0);
        assert_eq!(p.components.len(), 2);
        assert_eq!(p.body_rgba[4 * 4 + 3], 0);
        assert_eq!(p.body_rgba[8 * 4 + 3], 31);
        assert_eq!(p.body_rgba[4 * 4], 7);
        assert_eq!(p.alpha_at(-0.5 * p.scale, 0.0), 32);
        assert_eq!(p.alpha_at(-0.51 * p.scale, 0.0), 0);
    }

    #[test]
    fn rejects_empty_invalid_and_over_budget() {
        assert_eq!(
            prepare(0, 1, &[], 100).unwrap_err(),
            Error::InvalidDimensions
        );
        assert_eq!(prepare(1, 1, &[], 100).unwrap_err(), Error::InvalidPixels);
        assert_eq!(
            prepare(1, 1, &[0; 4], 10_000).unwrap_err(),
            Error::EmptyHeart
        );
        assert_eq!(
            prepare(1, 1, &[255; 4], 0).unwrap_err(),
            Error::BudgetExceeded
        );
    }

    #[test]
    fn component_crop_only_copies_its_own_pixels() {
        let width = 23;
        let height = 10;
        let mut rgba = vec![0; width * height * 4];
        for y in 0..10 {
            for x in 0..11 {
                rgba[(y * width + x) * 4..(y * width + x) * 4 + 4].fill(255);
            }
            for x in 13..18 {
                rgba[(y * width + x) * 4..(y * width + x) * 4 + 4].fill(123);
            }
        }
        let p = prepare(width, height, &rgba, 100_000).unwrap();
        assert_eq!(p.chips.len(), 1);
        let c = &p.chips[0];
        assert_eq!([c.width, c.height], [9, 14]);
        assert_eq!(c.rgba.iter().filter(|v| **v == 123).count(), 50 * 4);
        assert_eq!(c.display_size, [549, 854]);
        assert_eq!(c.center, [945.5, 305.0]);
    }
}

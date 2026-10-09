//! JSON and Number() compatibility needed by the pinned HyperFrames normalizer.
use std::borrow::Cow;

pub(super) fn clamp_number(number: f64, min: f64, max: f64) -> f64 {
    // Math.max(+0, -0) is +0. Rust clamp otherwise preserves the input's sign
    // on equality, which is correct for an upper +0 bound and a negative min.
    if number == 0.0 && min == 0.0 {
        0.0
    } else {
        number.clamp(min, max)
    }
}

fn js_whitespace(c: char) -> bool {
    matches!(c, '\u{0009}'..='\u{000d}' | '\u{0020}' | '\u{00a0}' | '\u{1680}'
        | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}'
        | '\u{205f}' | '\u{3000}' | '\u{feff}')
}

pub(super) fn number_string(raw: &str) -> Option<f64> {
    let value = raw.trim_matches(js_whitespace);
    if value.is_empty() {
        return None;
    }
    let radix = match value.as_bytes().get(..2) {
        Some(b"0x" | b"0X") => Some(16),
        Some(b"0b" | b"0B") => Some(2),
        Some(b"0o" | b"0O") => Some(8),
        _ => None,
    };
    let number = match radix {
        Some(radix) => radix_number(&value[2..], radix)?,
        None => value.parse::<f64>().ok()?,
    };
    number.is_finite().then_some(number)
}

fn radix_number(value: &str, radix: u32) -> Option<f64> {
    if value.is_empty() || !value.is_ascii() {
        return None;
    }
    // Retain 53 significand bits, a guard bit and sticky bits. Accumulating into
    // f64 directly can mis-round a long hex integer at the finite/Infinity edge.
    let mut significand = 0u64;
    let mut bits = 0usize;
    let mut guard = false;
    let mut sticky = false;
    for digit in value.chars() {
        let digit = digit.to_digit(radix)?;
        for shift in (0..radix.ilog2()).rev() {
            let set = digit & (1 << shift) != 0;
            if bits == 0 && !set {
                continue;
            }
            bits += 1;
            match bits {
                1..=53 => significand = (significand << 1) | u64::from(set),
                54 => guard = set,
                _ => sticky |= set,
            }
        }
    }
    if bits <= 53 {
        return Some(significand as f64);
    }
    if bits > 1024 {
        return Some(f64::INFINITY);
    }
    if guard && (sticky || significand & 1 == 1) {
        significand += 1;
    }
    Some(significand as f64 * 2.0f64.powi((bits - 53) as i32))
}

fn json_number(token: &str) -> bool {
    let bytes = token.as_bytes();
    let mut i = usize::from(bytes.first() == Some(&b'-'));
    match bytes.get(i) {
        Some(b'0') => i += 1,
        Some(b'1'..=b'9') => {
            i += 1;
            while bytes.get(i).is_some_and(u8::is_ascii_digit) {
                i += 1;
            }
        }
        _ => return false,
    }
    if bytes.get(i) == Some(&b'.') {
        i += 1;
        let start = i;
        while bytes.get(i).is_some_and(u8::is_ascii_digit) {
            i += 1;
        }
        if i == start {
            return false;
        }
    }
    if matches!(bytes.get(i), Some(b'e' | b'E')) {
        i += 1;
        if matches!(bytes.get(i), Some(b'+' | b'-')) {
            i += 1;
        }
        let start = i;
        while bytes.get(i).is_some_and(u8::is_ascii_digit) {
            i += 1;
        }
        if i == start {
            return false;
        }
    }
    i == bytes.len()
}

/// JSON.parse accepts numeric overflow as Infinity. serde_json rejects it.
/// Null has the identical FX-field normalization result: numeric defaults,
/// omitted presetAmount, enabled=true, or invalid version/type. Only complete
/// valid JSON-number tokens outside strings are replaced; serde still validates
/// the entire document, including malformed adjacent tokens and leading zeros.
pub(super) fn replace_overflow_numbers(input: &str) -> Cow<'_, str> {
    let bytes = input.as_bytes();
    let mut output = String::new();
    let mut copied = 0;
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'"' {
            i += 1;
            while i < bytes.len() {
                let byte = bytes[i];
                i += 1;
                if byte == b'\\' {
                    i = (i + 1).min(bytes.len());
                } else if byte == b'"' {
                    break;
                }
            }
        } else if matches!(bytes[i], b'-' | b'0'..=b'9') {
            let start = i;
            while i < bytes.len()
                && matches!(bytes[i], b'0'..=b'9' | b'e' | b'E' | b'+' | b'-' | b'.')
            {
                i += 1;
            }
            let token = &input[start..i];
            if json_number(token) && token.parse::<f64>().is_ok_and(|n| !n.is_finite()) {
                output.push_str(&input[copied..start]);
                output.push_str("null");
                copied = i;
            }
        } else {
            i += 1;
        }
    }
    if copied == 0 {
        Cow::Borrowed(input)
    } else {
        output.push_str(&input[copied..]);
        Cow::Owned(output)
    }
}

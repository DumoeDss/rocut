use super::{MAX_OUTPUT_BYTES, model::Response};
use std::io::{self, Write};

// Even the fallback is a small, complete request-error: never return a JSON prefix.
const FALLBACK: &str = "{\"version\":1,\"kind\":\"request-error\",\"error\":{\"code\":\"output-bytes\",\"path\":\"$\",\"message\":\"Unable to encode response within output budget\"}}";

struct Bounded {
    bytes: Vec<u8>,
    limit: usize,
}

impl Write for Bounded {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if bytes.len() > self.limit.saturating_sub(self.bytes.len()) {
            return Err(io::Error::other("output budget exceeded"));
        }
        // Reserve exactly the bounded remainder, rather than geometric growth
        // beyond the cap. Allocator bookkeeping is not part of this byte budget.
        if self.bytes.capacity() - self.bytes.len() < bytes.len() {
            let target = self.limit.min(
                (self.bytes.len() + bytes.len())
                    .max(self.bytes.capacity().saturating_mul(2))
                    .max(1024),
            );
            self.bytes
                .try_reserve_exact(target - self.bytes.len())
                .map_err(io::Error::other)?;
        }
        self.bytes.extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

pub(super) fn response(response: &Response) -> String {
    bounded(response, MAX_OUTPUT_BYTES)
}

fn bounded(response: &Response, limit: usize) -> String {
    let mut writer = Bounded {
        bytes: Vec::new(),
        limit,
    };
    if serde_json::to_writer(&mut writer, response).is_err() {
        return FALLBACK.into();
    }
    String::from_utf8(writer.bytes).unwrap_or_else(|_| FALLBACK.into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::animation_boundary::model::{Error, Item, ResultKind};
    #[test]
    fn output_failure_is_atomic_even_for_error_envelopes() {
        let response = Response::request_error(Error::new("schema", "$", "Invalid schema"));
        let output = bounded(&response, 1);
        assert_eq!(output, FALLBACK);
        assert!(serde_json::from_str::<serde_json::Value>(&output).is_ok());
        assert!(output.len() < MAX_OUTPUT_BYTES);
    }

    #[test]
    fn output_failure_does_not_expose_a_partial_batch() {
        let response = Response::batch(
            vec![Item {
                id: "one".into(),
                result: ResultKind::Values {
                    values: vec![f64::MAX; 100],
                },
            }],
            None,
        );
        let output = bounded(&response, 128);
        assert_eq!(output, FALLBACK);
        assert!(
            serde_json::from_str::<serde_json::Value>(&output)
                .unwrap()
                .get("results")
                .is_none()
        );
    }
}

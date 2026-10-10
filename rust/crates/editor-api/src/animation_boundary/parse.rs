use super::{MAX_JSON_DEPTH, MAX_JSON_NODES, MAX_STRING_BYTES, model::Error};
use serde::de::{self, DeserializeSeed, MapAccess, SeqAccess, Visitor};
use serde_json::{Map, Number, Value};
use std::fmt;

struct State {
    nodes: usize,
    failure: Option<Error>,
}
struct Seed<'a> {
    state: &'a mut State,
    path: String,
    depth: usize,
}

pub(super) fn parse(input: &str) -> Result<Value, Error> {
    if input.trim().is_empty() {
        return Err(Error::new("empty-input", "$", "A JSON request is required"));
    }
    let mut state = State {
        nodes: 0,
        failure: None,
    };
    let mut parser = serde_json::Deserializer::from_str(input);
    let result = Seed {
        state: &mut state,
        path: "$".into(),
        depth: 0,
    }
    .deserialize(&mut parser);
    match result {
        Ok(value) => parser
            .end()
            .map(|_| value)
            .map_err(|_| Error::new("invalid-json", "$", "Expected exactly one JSON value")),
        Err(_) => Err(state.failure.unwrap_or_else(|| {
            Error::new("invalid-json", "$", "Malformed or non-finite JSON input")
        })),
    }
}

impl Seed<'_> {
    fn fail<E: de::Error>(&mut self, code: &'static str, message: &'static str) -> E {
        self.state.failure = Some(Error::new(code, &self.path, message));
        E::custom(code)
    }
    fn string<E: de::Error>(&mut self, value: &str) -> Result<(), E> {
        if value.len() > MAX_STRING_BYTES {
            return Err(self.fail("string-bytes", "Decoded strings exceed 256 UTF-8 bytes"));
        }
        Ok(())
    }
}

impl<'de> DeserializeSeed<'de> for Seed<'_> {
    type Value = Value;
    fn deserialize<D: de::Deserializer<'de>>(mut self, deserializer: D) -> Result<Value, D::Error> {
        if self.depth > MAX_JSON_DEPTH {
            return Err(self.fail("json-depth", "JSON nesting exceeds 16 levels"));
        }
        if self.state.nodes == MAX_JSON_NODES {
            return Err(self.fail("json-nodes", "JSON value count exceeds 1000000"));
        }
        self.state.nodes += 1;
        deserializer.deserialize_any(self)
    }
}

impl<'de> Visitor<'de> for Seed<'_> {
    type Value = Value;
    fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        formatter.write_str("bounded JSON value")
    }
    fn visit_bool<E: de::Error>(self, value: bool) -> Result<Value, E> {
        Ok(Value::Bool(value))
    }
    fn visit_i64<E: de::Error>(self, value: i64) -> Result<Value, E> {
        Ok(Value::Number(value.into()))
    }
    fn visit_u64<E: de::Error>(self, value: u64) -> Result<Value, E> {
        Ok(Value::Number(value.into()))
    }
    fn visit_f64<E: de::Error>(mut self, value: f64) -> Result<Value, E> {
        Number::from_f64(value)
            .map(Value::Number)
            .ok_or_else(|| self.fail("non-finite-input", "Numbers must be finite"))
    }
    fn visit_str<E: de::Error>(mut self, value: &str) -> Result<Value, E> {
        self.string(value)?;
        Ok(Value::String(value.into()))
    }
    fn visit_string<E: de::Error>(mut self, value: String) -> Result<Value, E> {
        self.string(&value)?;
        Ok(Value::String(value))
    }
    fn visit_none<E: de::Error>(self) -> Result<Value, E> {
        Ok(Value::Null)
    }
    fn visit_unit<E: de::Error>(self) -> Result<Value, E> {
        Ok(Value::Null)
    }
    fn visit_seq<A: SeqAccess<'de>>(self, mut sequence: A) -> Result<Value, A::Error> {
        let mut values = Vec::new();
        loop {
            let child = Seed {
                state: self.state,
                path: format!("{}/{}", self.path, values.len()),
                depth: self.depth + 1,
            };
            match sequence.next_element_seed(child)? {
                Some(value) => values.push(value),
                None => return Ok(Value::Array(values)),
            }
        }
    }
    fn visit_map<A: MapAccess<'de>>(mut self, mut entries: A) -> Result<Value, A::Error> {
        let mut values = Map::new();
        while let Some(key) = entries.next_key::<String>()? {
            self.string(&key)?;
            if values.contains_key(&key) {
                return Err(self.fail("duplicate-field", "Duplicate JSON object field"));
            }
            let path = super::read::path(&self.path, &key);
            let child = Seed {
                state: self.state,
                path,
                depth: self.depth + 1,
            };
            let value = entries.next_value_seed(child)?;
            values.insert(key, value);
        }
        Ok(Value::Object(values))
    }
}

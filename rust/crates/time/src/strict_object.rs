//! serde-wasm-bindgen's struct fast path reads declared fields only. Decode a
//! map explicitly so deny_unknown_fields sees every key, without JSON conversion
//! (which would erase NaN/Infinity and the distinction between absent and null).
use serde::de::{MapAccess, Visitor, value::MapAccessDeserializer};
use serde::{Deserialize, Deserializer};
use std::fmt;
use std::marker::PhantomData;

pub(crate) fn from_map<'de, T: Deserialize<'de>, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<T, D::Error> {
    struct ObjectVisitor<T>(PhantomData<T>);
    impl<'de, T: Deserialize<'de>> Visitor<'de> for ObjectVisitor<T> {
        type Value = T;
        fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
            formatter.write_str("an object with only the declared fields")
        }
        fn visit_map<A: MapAccess<'de>>(self, map: A) -> Result<T, A::Error> {
            T::deserialize(MapAccessDeserializer::new(map))
        }
    }
    deserializer.deserialize_map(ObjectVisitor(PhantomData))
}

// Keep the field list single-source for serde, Tsify and the native public type.
macro_rules! strict_object {
    ($(#[$attr:meta])* pub struct $name:ident {
        $($(#[$field_attr:meta])* pub $field:ident: $ty:ty,)*
    }) => {
        $(#[$attr])*
        pub struct $name {
            $($(#[$field_attr])* pub $field: $ty,)*
        }
        impl<'de> serde::Deserialize<'de> for $name {
            fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
                #[derive(serde::Deserialize)]
                #[serde(rename_all = "camelCase", deny_unknown_fields)]
                struct Fields { $($(#[$field_attr])* $field: $ty,)* }
                let Fields { $($field,)* } = crate::strict_object::from_map(deserializer)?;
                Ok(Self { $($field,)* })
            }
        }
    };
}
pub(crate) use strict_object;

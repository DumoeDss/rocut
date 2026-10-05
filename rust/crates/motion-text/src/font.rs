use std::collections::BTreeSet;

use bridge::export;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InspectMotionTextFontOptions {
    #[serde(with = "serde_bytes")]
    #[cfg_attr(feature = "wasm", tsify(type = "Uint8Array"))]
    pub bytes: Vec<u8>,
    pub text: String,
    #[serde(default)]
    pub face_index: u32,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi))]
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MotionTextFontInspection {
    pub content_digest: String,
    pub face_index: u32,
    pub glyph_count: u16,
    pub missing_code_points: Vec<u32>,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, missing_as_null))]
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MotionTextFontInspectionResult {
    pub inspection: Option<MotionTextFontInspection>,
    pub error: Option<String>,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi))]
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MotionTextFontCoverage {
    pub face_index: u32,
    pub glyph_count: u16,
    pub missing_code_points: Vec<u32>,
}

#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, missing_as_null))]
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MotionTextFontCoverageResult {
    pub inspection: Option<MotionTextFontCoverage>,
    pub error: Option<String>,
}

#[export]
pub fn inspect_motion_text_font(
    options: InspectMotionTextFontOptions,
) -> MotionTextFontInspectionResult {
    let result = font_coverage(&options);
    MotionTextFontInspectionResult {
        inspection: result.inspection.map(|coverage| MotionTextFontInspection {
            content_digest: sha256_digest(&options.bytes),
            face_index: coverage.face_index,
            glyph_count: coverage.glyph_count,
            missing_code_points: coverage.missing_code_points,
        }),
        error: result.error,
    }
}

/// Check changing text against immutable, already authenticated font bytes.
/// This does not establish content identity: callers must retain the full
/// inspection/digest check when loading or replacing the font resource.
#[export]
pub fn inspect_motion_text_font_coverage(
    options: InspectMotionTextFontOptions,
) -> MotionTextFontCoverageResult {
    font_coverage(&options)
}

fn font_coverage(options: &InspectMotionTextFontOptions) -> MotionTextFontCoverageResult {
    let face = match ttf_parser::Face::parse(&options.bytes, options.face_index) {
        Ok(face) => face,
        Err(error) => {
            return MotionTextFontCoverageResult {
                inspection: None,
                error: Some(format!("invalid-font:{error:?}")),
            };
        }
    };

    let missing_code_points = options
        .text
        .chars()
        .filter(|character| !character.is_control())
        .filter(|character| face.glyph_index(*character).is_none())
        .map(u32::from)
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();

    MotionTextFontCoverageResult {
        inspection: Some(MotionTextFontCoverage {
            face_index: options.face_index,
            glyph_count: face.number_of_glyphs(),
            missing_code_points,
        }),
        error: None,
    }
}

fn sha256_digest(bytes: &[u8]) -> String {
    format!("sha256:{:x}", Sha256::digest(bytes))
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::fs;
    use std::path::PathBuf;

    use super::*;

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct FontCatalog {
        fonts: Vec<FontCatalogEntry>,
    }

    #[derive(Clone, Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct FontCatalogEntry {
        id: String,
        #[serde(default)]
        role_id: Option<String>,
        supported_languages: Vec<String>,
        builtin_path: String,
        content_digest: String,
    }

    fn repository_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..")
    }

    #[test]
    fn invalid_fonts_fail_closed_with_a_stable_digest() {
        let result = inspect_motion_text_font(InspectMotionTextFontOptions {
            bytes: b"not-a-font".to_vec(),
            text: "hello".to_owned(),
            face_index: 0,
        });

        assert!(result.inspection.is_none());
        assert!(
            result
                .error
                .as_deref()
                .is_some_and(|error| error.starts_with("invalid-font:"))
        );
        assert_eq!(
            sha256_digest(b"not-a-font"),
            "sha256:5e6ed95031c41c0c3c678d67c25b7fb67c229f8e3d51d8a2e92145e0ac077b29"
        );
        let coverage = inspect_motion_text_font_coverage(InspectMotionTextFontOptions {
            bytes: b"not-a-font".to_vec(), text: "hello".to_owned(), face_index: 0,
        });
        assert_eq!(coverage.error, result.error);
        assert!(coverage.inspection.is_none());
    }

    #[test]
    fn offline_jizura_fonts_parse_and_cover_declared_language_samples() {
        let catalog_source = fs::read_to_string(
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/jizura-font-catalog.json"),
        )
        .expect("font catalog is readable");
        let catalog: FontCatalog =
            serde_json::from_str(&catalog_source).expect("font catalog is valid JSON");
        let roles: BTreeSet<_> = catalog
            .fonts
            .iter()
            .map(|font| font.role_id.as_ref().unwrap_or(&font.id).clone())
            .collect();
        assert_eq!(roles.len(), 23);
        assert!(roles.iter().all(|role| {
            catalog
                .fonts
                .iter()
                .any(|font| font.id == *role && font.role_id.as_ref().is_none_or(|id| id == role))
        }));

        let base_asset_count = catalog
            .fonts
            .iter()
            .filter(|font| font.role_id.as_ref().is_none_or(|role| role == &font.id))
            .map(|font| font.builtin_path.clone())
            .collect::<BTreeSet<_>>()
            .len();
        assert_eq!(base_asset_count, 18);
        let mut unique = BTreeMap::new();
        for font in catalog.fonts {
            unique.entry(font.builtin_path.clone()).or_insert(font);
        }
        assert!(unique.len() >= base_asset_count);

        for font in unique.into_values() {
            let bytes = fs::read(
                repository_root()
                    .join("apps/web/public")
                    .join(&font.builtin_path),
            )
            .unwrap_or_else(|error| panic!("failed to read {}: {error}", font.id));
            for language in &font.supported_languages {
                let sample = match language.to_ascii_lowercase().as_str() {
                    "en" => "OpenCut 123 Motion Text",
                    "ja" => "OpenCut 123 歌詞日本語あア",
                    "zh-hans" => "城里的光让我们记住镜头说过的话，远处雾中的颜色与节拍。",
                    "ko" => "OpenCut 123 한국어 가사",
                    other => panic!(
                        "{} declares {other} without a catalog coverage sample",
                        font.id
                    ),
                };
                let result = inspect_motion_text_font(InspectMotionTextFontOptions {
                    bytes: bytes.clone(),
                    text: sample.to_owned(),
                    face_index: 0,
                });
                assert_eq!(result.error, None, "{} must parse for {language}", font.id);
                let inspection = result.inspection.expect("valid fonts return an inspection");
                let coverage = inspect_motion_text_font_coverage(InspectMotionTextFontOptions {
                    bytes: bytes.clone(), text: sample.to_owned(), face_index: 0,
                }).inspection.expect("coverage must parse the same valid face");
                assert_eq!(coverage.face_index, inspection.face_index);
                assert_eq!(coverage.glyph_count, inspection.glyph_count);
                assert_eq!(coverage.missing_code_points, inspection.missing_code_points);
                assert_eq!(
                    inspection.content_digest, font.content_digest,
                    "{} for {language}",
                    font.id
                );
                assert!(
                    inspection.missing_code_points.is_empty(),
                    "{} must cover its declared {language} sample; missing {:?}",
                    font.id,
                    inspection.missing_code_points
                );
            }
        }
    }

    #[test]
    fn coverage_reports_unique_missing_scalars_and_rejects_invalid_faces() {
        let bytes = fs::read(repository_root().join("apps/web/public/motion-text/fonts/ibm-plex-mono-medium.ttf")).unwrap();
        let options = InspectMotionTextFontOptions {
            bytes, text: "A\n\t\u{10ffff}\u{10ffff}\u{10fffe}".to_owned(), face_index: 0,
        };
        let full = inspect_motion_text_font(options.clone()).inspection.unwrap();
        let coverage = inspect_motion_text_font_coverage(options.clone()).inspection.unwrap();
        assert_eq!(coverage.missing_code_points, vec![0x10fffe, 0x10ffff]);
        assert_eq!(coverage.missing_code_points, full.missing_code_points);
        assert!(inspect_motion_text_font_coverage(InspectMotionTextFontOptions { face_index: u32::MAX, ..options }).inspection.is_none());
    }
}

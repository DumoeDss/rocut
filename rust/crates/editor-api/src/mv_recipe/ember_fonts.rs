use super::{hud::plain, model::Ember};
use crate::{
    mv_font_metrics::{AdvanceRequest, Request},
    mv_recipe::model::Scene,
    programmatic_resources::Resource,
};
use std::collections::{BTreeMap, BTreeSet};

pub(in crate::mv_recipe) fn append(
    recipe: &crate::mv_recipe::Recipe,
    resources: &[Resource],
    requests: &mut Vec<Request>,
) -> Result<(), String> {
    let mut fonts = BTreeMap::<&str, BTreeSet<String>>::new();
    for node in &recipe.nodes {
        let hud = match &node.scene {
            Scene::Ember {
                settings: Ember::Breathe(a),
                ..
            } => &a.hud,
            Scene::Ember {
                settings: Ember::Ignite(a),
                ..
            } => &a.hud,
            _ => continue,
        };
        let strings = fonts.entry(&hud.font).or_default();
        let mut prefix = String::new();
        strings.insert(prefix.clone());
        for character in hud.title.chars() {
            prefix.push(character);
            strings.insert(plain(&prefix));
        }
        if hud.title.contains('Ō') {
            strings.insert("O".into());
        }
    }
    for (id, strings) in fonts {
        let resource = resources
            .iter()
            .find(|r| r.id == id && r.kind == "font")
            .ok_or("Ember HUD requires a declared font identity")?;
        let index = if let Some(index) = requests.iter().position(|r| r.resource.id == id) {
            index
        } else {
            requests.push(Request {
                resource: resource.clone(),
                glyphs: Vec::new(),
                advances: Vec::new(),
                bounds: Vec::new(),
            });
            requests.len() - 1
        };
        for text in strings {
            if !requests[index]
                .advances
                .iter()
                .any(|a| a.text == text && a.font_size_px == 22.0 && a.letter_spacing_px == 0.0)
            {
                requests[index].advances.push(AdvanceRequest {
                    text,
                    font_size_px: 22.0,
                    letter_spacing_px: 0.0,
                });
            }
        }
    }
    let mut scalars = 0;
    let mut count = 0;
    for request in requests.iter() {
        for a in &request.advances {
            count += 1;
            scalars += a.text.chars().count();
        }
    }
    if requests.len() > 64 || count > 1024 || scalars > 65536 {
        return Err("Ember HUD exceeds shared font advance/text budget".into());
    }
    Ok(())
}

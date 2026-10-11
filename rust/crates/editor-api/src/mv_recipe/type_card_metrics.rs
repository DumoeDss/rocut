use super::{model::TypeCard, rules};
use crate::{
    mv_font_metrics::{MAX_GLYPHS, Request},
    mv_recipe::{Recipe, model::Scene},
    programmatic_resources::Resource,
};
use std::collections::{BTreeMap, BTreeSet};

impl Recipe {
    pub(crate) fn font_metric_requests(
        &self,
        resources: &[Resource],
    ) -> Result<Vec<Request>, String> {
        let mut requests = BTreeMap::<&str, BTreeSet<String>>::new();
        let mut total = 0;
        for node in &self.nodes {
            let Scene::TypeCard {
                settings: TypeCard::Quiet(a),
                ..
            } = &node.scene
            else {
                continue;
            };
            if a.glyphs.len() > rules::MAX_GLYPHS {
                return Err("TypeCard quiet glyph limit exceeded".into());
            }
            let glyphs = requests.entry(&a.font).or_default();
            for glyph in &a.glyphs {
                if !rules::text(&glyph.text, 1) {
                    return Err("TypeCard metrics require individual Unicode scalars".into());
                }
                if glyphs.insert(glyph.text.clone()) {
                    total += 1;
                }
                if total > MAX_GLYPHS {
                    return Err("MV font metrics exceed 1024 unique glyphs".into());
                }
            }
        }
        let mut requests = requests
            .into_iter()
            .map(|(id, glyphs)| {
                let mut matches = resources.iter().filter(|r| r.id == id && r.kind == "font");
                let resource = matches
                    .next()
                    .ok_or("TypeCard metrics require a declared font resource")?;
                if matches.next().is_some() {
                    return Err("Duplicate font resource in TypeCard metrics".into());
                }
                Ok(Request {
                    resource: resource.clone(),
                    glyphs: glyphs.into_iter().collect(),
                    advances: Vec::new(),
                    bounds: Vec::new(),
                })
            })
            .collect::<Result<Vec<_>, String>>()?;
        crate::mv_recipe::ember::append_font_requests(self, resources, &mut requests)?;
        crate::mv_recipe::title_riff::append_font_requests(self, resources, &mut requests)?;
        for node in &self.nodes {
            if let Scene::Rewind { settings, .. } = &node.scene {
                for request in settings.font_requests(resources)? {
                    if let Some(existing) = requests
                        .iter_mut()
                        .find(|r| r.resource.id == request.resource.id)
                    {
                        for glyph in request.glyphs {
                            if !existing.glyphs.contains(&glyph) {
                                existing.glyphs.push(glyph);
                            }
                        }
                        for advance in request.advances {
                            existing.advances.push(advance);
                        }
                    } else {
                        requests.push(request);
                    }
                }
            }
            if let Scene::Burst { settings, .. } = &node.scene {
                for request in crate::mv_recipe::burst::font_requests(settings, resources)? {
                    if let Some(existing) = requests
                        .iter_mut()
                        .find(|r| r.resource.id == request.resource.id)
                    {
                        for glyph in request.glyphs {
                            if !existing.glyphs.contains(&glyph) {
                                existing.glyphs.push(glyph);
                            }
                        }
                    } else {
                        requests.push(request);
                    }
                }
            }
            if let Scene::KanjiSlam { settings, .. } = &node.scene {
                settings.static_requests(resources, &mut requests)?;
            }
        }
        if requests.iter().map(|r| r.glyphs.len()).sum::<usize>() > MAX_GLYPHS {
            return Err("MV font metrics exceed 1024 unique glyphs".into());
        }
        Ok(requests)
    }
}

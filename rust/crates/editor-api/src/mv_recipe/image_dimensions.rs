use super::Recipe;
use crate::{
    mv_image_dimensions::{self, Request},
    programmatic_resources::Resource,
};

impl Recipe {
    pub(crate) fn image_dimension_requests(
        &self,
        resources: &[Resource],
    ) -> Result<Vec<Request>, String> {
        let native_ids = self.nodes.iter().flat_map(|node| match &node.scene {
            super::model::Scene::KanjiSlam { settings, .. } => settings.images(),
            super::model::Scene::TitleRiff { settings, .. } => settings.images(),
            super::model::Scene::Ember { settings, .. } => settings.image().into_iter().collect(),
            _ => Vec::new(),
        });
        // Both raster backends already decode/retain every declared image at
        // render time, including hidden and unused resources. Measure that same
        // resident set before issuing any plan, not only native-scene masks.
        // The shared collector deduplicates IDs used by more than one scene.
        let ids: Vec<_> = native_ids
            .chain(
                resources
                    .iter()
                    .filter(|resource| resource.kind == "image")
                    .map(|resource| resource.id.as_str()),
            )
            .collect();
        mv_image_dimensions::requests(resources, &ids)
    }
}

//! Typed production bridge; the frozen producers retain all scene semantics.
use super::{BackgroundFact, HeartGather, Plan, Sample, Session, SunBloom};

impl Session {
    pub fn gather_frame(
        &self,
        settings: &HeartGather,
        sample: &Sample<'_>,
        character: &BackgroundFact<'_>,
    ) -> Result<Plan, String> {
        super::gather::frame(self, settings, sample, character)
    }

    pub fn sun_frame(
        &self,
        settings: &SunBloom,
        sample: &Sample<'_>,
        character: &BackgroundFact<'_>,
    ) -> Result<Plan, String> {
        super::sun::frame(self, settings, sample, character)
    }
}

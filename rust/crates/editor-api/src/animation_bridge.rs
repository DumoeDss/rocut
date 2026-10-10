//! Explicit numeric inspection/sampling; this does not change legacy admission.

#[bridge::export]
pub fn sample_scalar_animation_batch_json(input: String) -> String {
    crate::animation_boundary::sample_scalar_animation_batch_json(input)
}

#[bridge::export]
pub fn inspect_scalar_animation_domains_json(input: String) -> String {
    crate::animation_boundary::inspect_scalar_animation_domains_json(input)
}

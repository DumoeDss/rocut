//! Surface policy only: effect and compositor textures remain straight RGBA.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum AlphaMode {
    Opaque,
    PreMultiplied,
    PostMultiplied,
    Unspecified,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SurfaceTarget {
    Native,
    BrowserWebGpu,
    BrowserWebGl,
}

pub(crate) fn select_alpha_mode(
    supported: &[AlphaMode],
    target: SurfaceTarget,
) -> Option<AlphaMode> {
    if target == SurfaceTarget::BrowserWebGpu {
        // wgpu 29.0.1 backend/webgpu.rs reports only Opaque in capabilities,
        // but configure explicitly supports PreMultiplied and maps it to the
        // WebGPU canvas contract. PostMultiplied instead panics in that backend.
        Some(AlphaMode::PreMultiplied)
    } else if target == SurfaceTarget::Native {
        // Retain native WSI capability order and the old Auto fallback, including
        // Inherit/Auto modes whose compositing semantics are outside this fix.
        Some(supported.first().copied().unwrap_or(AlphaMode::Unspecified))
    } else {
        supported.first().copied()
    }
}

pub(crate) fn premultiply_for_surface(
    configured: AlphaMode,
    target: SurfaceTarget,
) -> Option<bool> {
    match (target, configured) {
        (
            SurfaceTarget::BrowserWebGpu,
            AlphaMode::Opaque | AlphaMode::PostMultiplied | AlphaMode::Unspecified,
        ) => None,
        // wgpu-hal's browser GL surface currently advertises only Opaque, but
        // its actual WebGL canvas retains the default premultipliedAlpha=true.
        (SurfaceTarget::BrowserWebGl, _) | (_, AlphaMode::PreMultiplied) => Some(true),
        (_, AlphaMode::Opaque | AlphaMode::PostMultiplied | AlphaMode::Unspecified) => Some(false),
    }
}

#[cfg(test)]
mod tests {
    use super::{AlphaMode::*, SurfaceTarget::*, *};

    #[test]
    fn browser_webgpu_uses_supported_premultiplied_mode_despite_caps_omission() {
        for modes in [
            &[][..],
            &[Opaque][..],
            &[Opaque, PostMultiplied, PreMultiplied][..],
        ] {
            assert_eq!(select_alpha_mode(modes, BrowserWebGpu), Some(PreMultiplied));
        }
        assert_eq!(
            premultiply_for_surface(PreMultiplied, BrowserWebGpu),
            Some(true)
        );
    }

    #[test]
    fn browser_webgpu_never_selects_backend_panicking_postmultiplied_mode() {
        assert_eq!(
            select_alpha_mode(&[Opaque, PostMultiplied], BrowserWebGpu),
            Some(PreMultiplied)
        );
        assert_eq!(premultiply_for_surface(PostMultiplied, BrowserWebGpu), None);
    }

    #[test]
    fn browser_webgpu_rejects_opaque_or_unspecified_transparency() {
        assert_eq!(premultiply_for_surface(Opaque, BrowserWebGpu), None);
        assert_eq!(premultiply_for_surface(Unspecified, BrowserWebGpu), None);
    }

    #[test]
    fn browser_gl_presentation_matches_canvas_despite_opaque_capability() {
        assert_eq!(select_alpha_mode(&[Opaque], BrowserWebGl), Some(Opaque));
        assert_eq!(premultiply_for_surface(Opaque, BrowserWebGl), Some(true));
    }

    #[test]
    fn native_opaque_gl_is_not_treated_as_a_browser_canvas() {
        assert_eq!(
            select_alpha_mode(&[Opaque, PreMultiplied], Native),
            Some(Opaque)
        );
        assert_eq!(premultiply_for_surface(Opaque, Native), Some(false));
        assert_eq!(premultiply_for_surface(PreMultiplied, Native), Some(true));
        assert_eq!(premultiply_for_surface(PostMultiplied, Native), Some(false));
        assert_eq!(
            select_alpha_mode(&[Unspecified, Opaque], Native),
            Some(Unspecified)
        );
        assert_eq!(select_alpha_mode(&[Unspecified], Native), Some(Unspecified));
        assert_eq!(select_alpha_mode(&[], Native), Some(Unspecified));
        assert_eq!(premultiply_for_surface(Unspecified, Native), Some(false));
    }

    #[test]
    fn presentation_uses_configured_mode_not_a_new_capability_preference() {
        let preferred = select_alpha_mode(&[PreMultiplied, PostMultiplied], Native).unwrap();
        assert_eq!(preferred, PreMultiplied);
        assert_eq!(premultiply_for_surface(PostMultiplied, Native), Some(false));
        assert_eq!(select_alpha_mode(&[], BrowserWebGl), None);
        assert_eq!(premultiply_for_surface(Unspecified, BrowserWebGpu), None);
    }
}

#[path = "support/liquid.rs"]
mod liquid;
#[path = "support/liquid_fixture.rs"]
mod liquid_fixture;
mod support;

use effects::{EffectPipeline, UniformValue};
use gpu::GpuContext;
use liquid::{Optics, assert_raster, changed_pixels, pass, reference, source};
use serde_json::json;
use support::{block_on, render};

#[test]
#[ignore = "requires native GPU; run --test liquid -- --include-ignored"]
fn inactive_liquid_is_exact_identity_including_hidden_rgb() {
    let context = block_on(GpuContext::new()).unwrap();
    let pipeline = EffectPipeline::new(&context);
    for (width, height) in [(96, 64), (64, 96), (93, 62)] {
        let input = source(width, height, false, true);
        let portrait = width < height;
        let mut zero_amount = pass(json!({}), 24000, portrait);
        // Resolve an active pass first so this exercises shader identity too.
        zero_amount
            .uniforms
            .insert("amount".into(), UniformValue::Number(0.0));
        for (name, effect) in [
            ("zero amount", zero_amount),
            ("zero state", pass(json!({"eventCount":0}), 24000, portrait)),
            ("zero elapsed", pass(json!({}), 0, portrait)),
            (
                "future span",
                pass(json!({"startTicks":30000}), 24000, portrait),
            ),
            (
                "future impulse",
                pass(
                    json!({"event0Time":30000,"event1Time":40000}),
                    24000,
                    portrait,
                ),
            ),
        ] {
            assert_eq!(
                render(&context, &pipeline, &input, width, height, &[effect]),
                input,
                "{name}: exact identity at {width}x{height}"
            );
        }
    }
}

#[test]
#[ignore = "requires native GPU; run --test liquid -- --include-ignored"]
fn raster_matches_independent_frozen_flow_at_landscape_portrait_and_odd_sizes() {
    let context = block_on(GpuContext::new()).unwrap();
    let pipeline = EffectPipeline::new(&context);
    for (width, height) in [(96, 64), (64, 96), (93, 62)] {
        let portrait = width < height;
        let mut outputs = Vec::new();
        for alternate in [false, true] {
            let input = source(width, height, alternate, false);
            let expected = reference(&input, width, height, portrait, Optics::default());
            assert!(
                changed_pixels(&input, &expected) > 200,
                "fixture must visibly refract input"
            );
            let actual = render(
                &context,
                &pipeline,
                &input,
                width,
                height,
                &[pass(json!({}), 24000, portrait)],
            );
            assert_raster(&actual, &expected, width, "independent full raster");
            outputs.push(actual);
        }
        assert!(
            changed_pixels(&outputs[0], &outputs[1]) > 1000,
            "output must depend on source content"
        );
    }
}

#[test]
#[ignore = "requires native GPU; run --test liquid -- --include-ignored"]
fn alpha_holes_and_dye_tint_match_premultiplied_sampling_without_fringes() {
    let context = block_on(GpuContext::new()).unwrap();
    let pipeline = EffectPipeline::new(&context);
    let (width, height) = (96, 64);
    let input = source(width, height, false, true);
    let plain = Optics {
        dye_opacity: 0.0,
        ..Optics::default()
    };
    let tinted = Optics {
        dye_opacity: 1.0,
        color: [1.0, 0.125, 0.5],
        ..Optics::default()
    };
    let mut outputs = Vec::new();
    for optics in [plain, tinted] {
        let expected = reference(&input, width, height, false, optics);
        let actual = render(
            &context,
            &pipeline,
            &input,
            width,
            height,
            &[pass(optics.params(), 24000, false)],
        );
        assert_raster(&actual, &expected, width, "alpha holes and tint");
        outputs.push(actual);
    }
    assert_eq!(
        outputs[0].iter().skip(3).step_by(4).collect::<Vec<_>>(),
        outputs[1].iter().skip(3).step_by(4).collect::<Vec<_>>(),
        "dye cannot create opacity"
    );
    assert!(
        changed_pixels(&outputs[0], &outputs[1]) > 100,
        "dye must color existing coverage"
    );

    let green: Vec<u8> = input
        .chunks_exact(4)
        .flat_map(|p| {
            if p[3] == 0 {
                [255, 0, 255, 0]
            } else {
                [0, 255, 0, p[3]]
            }
        })
        .collect();
    let output = render(
        &context,
        &pipeline,
        &green,
        width,
        height,
        &[pass(plain.params(), 24000, false)],
    );
    assert_raster(
        &output,
        &reference(&green, width, height, false, plain),
        width,
        "hidden RGB rejection",
    );
    assert!(
        output.chunks_exact(4).any(|p| p[3] > 1 && p[3] < 96),
        "fixture must exercise partial alpha"
    );
    for p in output.chunks_exact(4).filter(|p| p[3] > 0) {
        assert_eq!(
            &p[..3],
            &[0, 255, 0],
            "transparent magenta leaked into visible color"
        );
    }
    let invisible: Vec<u8> = (0..width * height).flat_map(|_| [255, 0, 255, 0]).collect();
    let output = render(
        &context,
        &pipeline,
        &invisible,
        width,
        height,
        &[pass(json!({}), 24000, false)],
    );
    assert_raster(
        &output,
        &reference(&invisible, width, height, false, Optics::default()),
        width,
        "transparent source",
    );
    assert!(
        output.chunks_exact(4).all(|p| p[3] == 0),
        "Liquid cannot create source coverage"
    );
}

#[test]
#[ignore = "requires native GPU; run --test liquid -- --include-ignored"]
fn amount_blends_in_premultiplied_space_and_outside_source_is_transparent() {
    let context = block_on(GpuContext::new()).unwrap();
    let pipeline = EffectPipeline::new(&context);
    let (width, height) = (93, 62);
    for holes in [false, true] {
        let input = source(width, height, false, holes);
        let optics = Optics {
            amount: 0.5,
            ..Optics::default()
        };
        let expected = reference(&input, width, height, false, optics);
        let actual = render(
            &context,
            &pipeline,
            &input,
            width,
            height,
            &[pass(optics.params(), 24000, false)],
        );
        assert_raster(&actual, &expected, width, "half-amount premultiplied blend");
        if !holes {
            let exterior = expected.chunks_exact(4).filter(|p| p[3] < 255).count();
            assert!(
                exterior > 20,
                "fixture must sample transparent source exterior"
            );
            assert!(
                actual.chunks_exact(4).filter(|p| p[3] < 255).count() > 20,
                "edge clamping would incorrectly preserve opaque borders"
            );
        }
    }
}

#[test]
#[ignore = "requires native GPU; run --test liquid -- --include-ignored"]
fn authored_physics_and_optical_parameters_change_real_source_rendering() {
    let context = block_on(GpuContext::new()).unwrap();
    let pipeline = EffectPipeline::new(&context);
    let input = source(96, 64, false, false);
    let draw = |changes| {
        render(
            &context,
            &pipeline,
            &input,
            96,
            64,
            &[pass(changes, 24000, false)],
        )
    };
    let baseline = draw(json!({}));
    assert_raster(
        &baseline,
        &reference(&input, 96, 64, false, Optics::default()),
        96,
        "parameter baseline",
    );
    for (name, changes) in [
        ("viscosity", json!({"viscosity":0.0})),
        ("velocity damping", json!({"velocityDamping":8.0})),
        ("dye dissipation", json!({"dyeDissipation":8.0})),
        ("vorticity", json!({"vorticity":0.0})),
        ("pressure iterations", json!({"pressureIterations":4})),
        ("second impulse", json!({"eventCount":1})),
    ] {
        assert_ne!(draw(changes), baseline, "{name} must not be ignored");
    }
    for optics in [
        Optics {
            refraction: 0.0,
            ..Optics::default()
        },
        Optics {
            dye_opacity: 0.0,
            ..Optics::default()
        },
    ] {
        let actual = draw(optics.params());
        assert_ne!(actual, baseline);
        assert_raster(
            &actual,
            &reference(&input, 96, 64, false, optics),
            96,
            "optical parameter isolation",
        );
    }
}

#[test]
#[ignore = "requires native GPU; run --test liquid -- --include-ignored"]
fn out_of_order_frame_span_and_dimension_evaluation_is_deterministic() {
    let context = block_on(GpuContext::new()).unwrap();
    let pipeline = EffectPipeline::new(&context);
    let input = source(96, 64, false, true);
    let draw = |changes, time| {
        render(
            &context,
            &pipeline,
            &input,
            96,
            64,
            &[pass(changes, time, false)],
        )
    };
    let expected = draw(json!({}), 24000);
    assert_raster(
        &expected,
        &reference(&input, 96, 64, false, Optics::default()),
        96,
        "seek baseline",
    );
    for time in [48000, 1000, 0, 32000, 8000] {
        let _ = draw(json!({}), time);
        assert_eq!(
            draw(json!({}), 24000),
            expected,
            "history leaked after frame {time}"
        );
    }
    let _ = render(
        &context,
        &pipeline,
        &source(64, 96, true, false),
        64,
        96,
        &[pass(json!({}), 24000, true)],
    );
    assert_eq!(
        draw(json!({}), 24000),
        expected,
        "previous output dimensions leaked"
    );
    assert_eq!(
        draw(json!({"startTicks":12000}), 36000),
        expected,
        "span mapping must preserve elapsed ticks"
    );
    assert_eq!(
        draw(json!({"durationTicks":24000}), 48000),
        expected,
        "duration must clamp replay time"
    );
    assert_eq!(
        draw(json!({}), 24999),
        expected,
        "subframe must floor before fixed-step replay"
    );
}

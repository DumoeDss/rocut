use wgpu::naga::{self, BinaryOperator, Expression, Function, Handle, Literal, MathFunction};

// Evaluate the scalar factor from the actual parsed shader, not a separately
// transcribed replacement formula. This is sequential f32 CPU evidence, not GPU
// execution; backend contraction and native transcendental precision remain GPU
// validation responsibilities.
fn shader() -> naga::Module {
    let module = naga::front::wgsl::parse_str(include_str!("../shaders/bubble.wgsl")).unwrap();
    naga::valid::Validator::new(
        naga::valid::ValidationFlags::all(),
        naga::valid::Capabilities::empty(),
    )
    .validate(&module)
    .unwrap();
    module
}

fn scalar(function: &Function, expression: Handle<Expression>, normal_z: f32, ior: f32) -> f32 {
    let eval = |value| scalar(function, value, normal_z, ior);
    match function.expressions[expression] {
        Expression::Literal(Literal::F32(value)) => value,
        Expression::FunctionArgument(1) => ior,
        Expression::AccessIndex { base, index: 2 }
            if matches!(function.expressions[base], Expression::FunctionArgument(0)) =>
        {
            normal_z
        }
        Expression::Binary { op, left, right } => {
            let (left, right) = (eval(left), eval(right));
            match op {
                BinaryOperator::Add => left + right,
                BinaryOperator::Subtract => left - right,
                BinaryOperator::Multiply => left * right,
                BinaryOperator::Divide => left / right,
                _ => panic!("Unsupported refraction operator: {op:?}"),
            }
        }
        Expression::Math {
            fun: MathFunction::Max,
            arg,
            arg1: Some(other),
            ..
        } => eval(arg).max(eval(other)),
        Expression::Math {
            fun: MathFunction::Sqrt,
            arg,
            ..
        } => eval(arg).sqrt(),
        ref other => panic!("Unsupported refraction expression: {other:?}"),
    }
}

fn factor(module: &naga::Module, normal_z: f32, ior: f32) -> f32 {
    let function = module
        .functions
        .iter()
        .find(|(_, function)| function.name.as_deref() == Some("bubble_refraction"))
        .unwrap()
        .1;
    let expression = *function
        .named_expressions
        .iter()
        .find(|(_, name)| name.as_str() == "factor")
        .unwrap()
        .0;
    scalar(function, expression, normal_z, ior)
}

#[test]
fn bubble_refraction_shader_factor_preserves_ior_one_at_grazing_incidence() {
    let module = shader();
    // Frozen f32 normal from the admitted 2048-square, 24-ball silhouette
    // fixture at pixel (1234, 1024), radius 0.474388062953949 and blend 1.
    let normal = [0.99996924_f32, -0.007852955_f32, 0.00017254721_f32];
    let old_k = 1.0_f32 - (1.0 - normal[2] * normal[2]);
    let old_factor = normal[2] - old_k.sqrt();
    let old_offset = 512.0 * old_factor * normal[0] / (1.0 - old_factor * normal[2]);
    assert_eq!(
        old_k, 0.0,
        "The original cancellation witness must remain sensitive"
    );
    assert!(
        old_offset > 0.088,
        "The old f32 expression displaced a sample by {old_offset} px"
    );
    assert_eq!(factor(&module, normal[2], 1.0), 0.0);

    for normal_z in [0.0, 1.0e-15, f32::EPSILON, 1.0e-6, 1.0e-4, 0.1, 0.5, 1.0] {
        assert_eq!(factor(&module, normal_z, 1.0), 0.0, "normal_z={normal_z}");
    }
}

#[test]
fn bubble_refraction_shader_factor_is_finite_across_admitted_ior_and_normal_bounds() {
    let module = shader();
    // Dispersion adjusts authored IOR [1, 2.5] by at most +/-0.045 and clamps
    // each channel to one, so the effective interval is [1, 2.545].
    for ior in [1.0_f32, 1.0 + f32::EPSILON, 1.0001, 1.33, 2.5, 2.545] {
        for sample in 0..=1024 {
            let normal_z = sample as f32 / 1024.0;
            let actual = factor(&module, normal_z, ior);
            // Compare arithmetic after the same f32 eta/eta-squared
            // quantization. The near-one square-root derivative magnifies
            // their representation error against an unquantized f64 IOR.
            let eta_f32 = 1.0_f32 / ior;
            let eta = f64::from(eta_f32);
            let eta_squared = f64::from(eta_f32 * eta_f32);
            let z = f64::from(normal_z);
            let expected = eta * z - ((1.0 - eta_squared) + eta_squared * z * z).sqrt();
            assert!(actual.is_finite(), "ior={ior}, normal_z={normal_z}");
            assert!(
                actual <= 0.0,
                "A ray cannot bend outward: ior={ior}, normal_z={normal_z}"
            );
            assert!(
                (f64::from(actual) - expected).abs() < 5.0e-7,
                "ior={ior}, normal_z={normal_z}, actual={actual}, expected={expected}"
            );
            let denominator = 1.0 / ior - actual * normal_z;
            assert!(denominator.is_finite() && denominator >= 1.0 / 2.545);
            let offset = 2048.0 * actual * (1.0 - normal_z * normal_z).sqrt() / denominator;
            assert!(offset.is_finite());
        }
    }
}

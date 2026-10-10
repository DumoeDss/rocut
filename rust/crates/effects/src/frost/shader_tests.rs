use wgpu::naga::{self, BinaryOperator, Expression, Function, Handle, Literal, Statement};

// Interpret the integer expressions/stores of the ACTUAL parsed WGSL hash.
// Frozen numbers below were independently calculated in unbounded BigInt
// arithmetic with explicit modulo 2^32, not by this interpreter or Rust hash.
fn scalar(
    function: &Function,
    expression: Handle<Expression>,
    cell: [i32; 2],
    seed: u32,
    salt: u32,
    value: u32,
) -> u32 {
    let eval = |e| scalar(function, e, cell, seed, salt, value);
    match function.expressions[expression] {
        Expression::Literal(Literal::U32(v)) => v,
        Expression::FunctionArgument(1) => salt,
        Expression::AccessIndex { base, index }
            if matches!(function.expressions[base], Expression::FunctionArgument(0)) =>
        {
            cell[index as usize] as u32
        }
        Expression::AccessIndex { base, index: 0 } => {
            let Expression::AccessIndex {
                base: global,
                index: 3,
            } = function.expressions[base]
            else {
                panic!("Expected metadata.x")
            };
            assert!(matches!(
                function.expressions[global],
                Expression::GlobalVariable(_)
            ));
            seed
        }
        Expression::As {
            expr,
            convert: None,
            ..
        } => eval(expr),
        Expression::Load { pointer } => {
            if matches!(function.expressions[pointer], Expression::LocalVariable(_)) {
                value
            } else {
                eval(pointer)
            }
        }
        Expression::Binary { op, left, right } => {
            let (l, r) = (eval(left), eval(right));
            match op {
                BinaryOperator::ExclusiveOr => l ^ r,
                BinaryOperator::Multiply => l.wrapping_mul(r),
                BinaryOperator::ShiftRight => l >> r,
                _ => panic!("Unsupported integer hash operation {op:?}"),
            }
        }
        ref other => panic!("Unsupported integer hash expression {other:?}"),
    }
}
fn actual_hash(module: &naga::Module, cell: [i32; 2], seed: u32, salt: u32) -> u32 {
    let f = module
        .functions
        .iter()
        .find(|(_, f)| f.name.as_deref() == Some("frost_hash"))
        .unwrap()
        .1;
    let mut current = 0;
    for statement in f.body.iter() {
        match *statement {
            Statement::Emit(_) => {}
            Statement::Store { pointer, value } => {
                assert!(matches!(
                    f.expressions[pointer],
                    Expression::LocalVariable(_)
                ));
                current = scalar(f, value, cell, seed, salt, current);
            }
            Statement::Return { value: Some(value) } => {
                return scalar(f, value, cell, seed, salt, current);
            }
            ref other => panic!("Unexpected integer hash statement {other:?}"),
        }
    }
    panic!("Hash has no return")
}
#[test]
fn frost_actual_wgsl_seed_hash_matches_independent_integer_vectors() {
    let module = naga::front::wgsl::parse_str(include_str!("../shaders/frost.wgsl")).unwrap();
    for (cell, seed, salt, expected) in [
        ([0, 0], 0, 0, 0),
        ([0, 0], 17, 1, 3412571707),
        ([0, 0], 18, 1, 3569609215),
        ([-1, -1], 17, 7, 1988316835),
        ([31, 15], 16777215, 8, 2903192679),
        ([256, 512], 1, 3, 98680791),
    ] {
        assert_eq!(
            actual_hash(&module, cell, seed, salt),
            expected,
            "{cell:?} seed={seed} salt={salt}"
        );
    }
}

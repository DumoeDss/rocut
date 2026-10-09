use super::{Point, VertexKey};

type Expansion = Vec<f64>;
type Line = [Expansion; 3];

// Error-free transforms operate on the bounded, long-normalized site domain.
// They use only f64 arithmetic, with no native platform or FMA dependency.
fn grow(values: &mut Expansion, mut value: f64) {
    let mut kept = 0;
    for index in 0..values.len() {
        let other = values[index];
        let sum = value + other;
        let virtual_other = sum - value;
        let error = (value - (sum - virtual_other)) + (other - virtual_other);
        if error != 0.0 {
            values[kept] = error;
            kept += 1;
        }
        value = sum;
    }
    values.truncate(kept);
    if value != 0.0 {
        values.push(value);
    }
}

fn add(a: &[f64], b: &[f64]) -> Expansion {
    let mut result = a.to_vec();
    for &term in b {
        grow(&mut result, term);
    }
    result
}
fn sub(a: &[f64], b: &[f64]) -> Expansion {
    let mut result = a.to_vec();
    for &term in b {
        grow(&mut result, -term);
    }
    result
}
fn split(value: f64) -> (f64, f64) {
    let expanded = 134_217_729.0 * value;
    let high = expanded - (expanded - value);
    (high, value - high)
}
fn mul(a: &[f64], b: &[f64]) -> Expansion {
    let mut result = Vec::new();
    for &x in a {
        for &y in b {
            let product = x * y;
            let (xh, xl) = split(x);
            let (yh, yl) = split(y);
            let error = xl * yl - (((product - xh * yh) - xl * yh) - xh * yl);
            grow(&mut result, error);
            grow(&mut result, product);
        }
    }
    result
}
fn sign(value: &[f64]) -> i8 {
    value.last().map_or(0, |n| if *n > 0.0 { 1 } else { -1 })
}
fn bisector(a: Point, b: Point) -> Line {
    let square = |p: Point| add(&mul(&[p[0]], &[p[0]]), &mul(&[p[1]], &[p[1]]));
    [
        sub(&[b[0]], &[a[0]]),
        sub(&[b[1]], &[a[1]]),
        mul(&sub(&square(a), &square(b)), &[0.5]),
    ]
}

pub(super) fn side(
    key: &VertexKey,
    source: usize,
    target: usize,
    sites: &[Point],
    size: Point,
) -> i8 {
    let mut lines = Vec::with_capacity(2);
    for (bit, line) in [
        (1, [vec![1.0], vec![], vec![]]),
        (2, [vec![1.0], vec![], vec![-size[0]]]),
        (4, [vec![], vec![1.0], vec![]]),
        (8, [vec![], vec![1.0], vec![-size[1]]]),
    ] {
        if key.boundary & bit != 0 {
            lines.push(line);
        }
    }
    for &index in key.sites.iter().skip(1) {
        if lines.len() == 2 {
            break;
        }
        lines.push(bisector(sites[key.sites[0]], sites[index]));
    }
    let [a, b] = [&lines[0], &lines[1]];
    let determinant = sub(&mul(&a[0], &b[1]), &mul(&a[1], &b[0]));
    let x = sub(&mul(&a[1], &b[2]), &mul(&a[2], &b[1]));
    let y = sub(&mul(&a[2], &b[0]), &mul(&a[0], &b[2]));
    let query = bisector(sites[source], sites[target]);
    let numerator = add(
        &add(&mul(&query[0], &x), &mul(&query[1], &y)),
        &mul(&query[2], &determinant),
    );
    assert_ne!(
        sign(&determinant),
        0,
        "independent Voronoi vertex constraints"
    );
    sign(&numerator) * sign(&determinant)
}

#[cfg(test)]
mod tests {
    use super::{VertexKey, side};

    #[test]
    fn exact_constraint_ties_are_distinct_from_nearby_sites_on_either_side() {
        let mut sites = vec![[0.25, 0.1875], [0.75, 0.1875], [0.5, 0.3125]];
        let key = VertexKey {
            boundary: 4,
            sites: vec![0, 1],
        };
        assert_eq!(side(&key, 0, 2, &sites, [1.0, 1.0]), 0);
        sites[2][1] = f64::from_bits(0.3125_f64.to_bits() + 1);
        assert_eq!(side(&key, 0, 2, &sites, [1.0, 1.0]), -1);
        sites[2][1] = f64::from_bits(0.3125_f64.to_bits() - 1);
        assert_eq!(side(&key, 0, 2, &sites, [1.0, 1.0]), 1);
    }
}

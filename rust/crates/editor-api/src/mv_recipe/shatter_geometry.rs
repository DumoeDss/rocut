use super::super::transitions::random;
use std::collections::BTreeMap;

#[path = "shatter_predicates.rs"]
mod precise;

type Point = [f64; 2];

#[derive(Clone, PartialEq, Eq, PartialOrd, Ord)]
struct VertexKey {
    boundary: u8,
    sites: Vec<usize>,
}

#[derive(Clone)]
struct Vertex {
    point: Point,
    key: VertexKey,
}

pub(super) struct Cell {
    pub key: u32,
    pub vertices: Vec<Point>,
}

fn clip(
    polygon: Vec<Vertex>,
    source: usize,
    site: usize,
    sites: &[Point],
    size: Point,
) -> Vec<Vertex> {
    let a = sites[source];
    let b = sites[site];
    let delta = [b[0] - a[0], b[1] - a[1]];
    let length = delta[0].hypot(delta[1]);
    let normal = [delta[0] / length, delta[1] / length];
    let middle = [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5];
    let distance = |vertex: &Vertex| {
        let p = vertex.point;
        let approximate = (p[0] - middle[0]) * normal[0] + (p[1] - middle[1]) * normal[1];
        if approximate.abs() > 1e-11 {
            approximate
        } else {
            // Coordinates are only approximations of their incident constraints.
            // A near-zero value is decided from those exact dyadic constraints,
            // not by merging vertices that happen to be spatially close.
            match precise::side(&vertex.key, source, site, sites, size) {
                0 => 0.0,
                sign => approximate
                    .abs()
                    .max(f64::MIN_POSITIVE)
                    .copysign(f64::from(sign)),
            }
        }
    };
    let mut result = Vec::with_capacity(polygon.len() + 1);
    let mut previous = polygon.last().expect("nonempty Voronoi cell").clone();
    let mut previous_distance = distance(&previous);
    for mut vertex in polygon {
        let current_distance = distance(&vertex);
        // A vertex on the bisector is retained and gains its incident site below.
        // Do not also emit an intersection at that endpoint with a partial key.
        if (previous_distance < 0.0 && current_distance > 0.0)
            || (previous_distance > 0.0 && current_distance < 0.0)
        {
            let t = previous_distance / (previous_distance - current_distance);
            let mut sites: Vec<_> = previous
                .key
                .sites
                .iter()
                .copied()
                .filter(|i| vertex.key.sites.contains(i))
                .collect();
            sites.push(site);
            sites.sort_unstable();
            sites.dedup();
            result.push(Vertex {
                point: [
                    previous.point[0] + t * (vertex.point[0] - previous.point[0]),
                    previous.point[1] + t * (vertex.point[1] - previous.point[1]),
                ],
                key: VertexKey {
                    boundary: previous.key.boundary & vertex.key.boundary,
                    sites,
                },
            });
        }
        if current_distance == 0.0 {
            vertex.key.sites.push(site);
            vertex.key.sites.sort_unstable();
            vertex.key.sites.dedup();
        }
        previous = vertex.clone();
        if current_distance <= 0.0 {
            result.push(vertex);
        }
        previous_distance = current_distance;
    }
    result
}

pub(super) fn cells(rect: [f64; 4], count: u32, seed: u32) -> Vec<Cell> {
    let long = rect[2].max(rect[3]);
    let size = [rect[2] / long, rect[3] / long];
    let columns = ((f64::from(count) * size[0] / size[1]).sqrt().round() as u32).clamp(1, count);
    let rows = count.div_ceil(columns);
    let sites: Vec<Point> = (0..count)
        .map(|index| {
            let row = index / columns;
            let row_count = columns.min(count - row * columns);
            [
                (f64::from(index % columns) + 0.15 + 0.7 * random(seed, index * 2))
                    / f64::from(row_count)
                    * size[0],
                (f64::from(row) + 0.15 + 0.7 * random(seed, index * 2 + 1)) / f64::from(rows)
                    * size[1],
            ]
        })
        .collect();
    partition(rect, &sites)
}

fn partition(rect: [f64; 4], sites: &[Point]) -> Vec<Cell> {
    let long = rect[2].max(rect[3]);
    let size = [rect[2] / long, rect[3] / long];
    let mut shared: BTreeMap<VertexKey, Point> = BTreeMap::new();
    sites
        .iter()
        .enumerate()
        .map(|(index, _)| {
            let mut polygon: Vec<_> = [
                ([0.0, 0.0], 1 | 4),
                ([size[0], 0.0], 2 | 4),
                (size, 2 | 8),
                ([0.0, size[1]], 1 | 8),
            ]
            .into_iter()
            .map(|(point, boundary)| Vertex {
                point,
                key: VertexKey {
                    boundary,
                    sites: vec![index],
                },
            })
            .collect();
            for other_index in 0..sites.len() {
                if index != other_index {
                    polygon = clip(polygon, index, other_index, sites, size);
                }
            }
            // Every site is distinct and strictly inside its stratification cell.
            // Equal incident constraints identify the same topological vertex.
            // Nearby vertices with different keys are never merged, even when the
            // connecting edge is tiny. Shared coordinates become bit-identical.
            for vertex in &mut polygon {
                if vertex.key.boundary.count_ones() >= 2 {
                    vertex.key.sites.clear();
                }
                vertex.point = *shared.entry(vertex.key.clone()).or_insert(vertex.point);
            }
            polygon.dedup_by(|a, b| a.key == b.key);
            if polygon.len() > 1 && polygon[0].key == polygon.last().unwrap().key {
                polygon.pop();
            }
            Cell {
                key: index as u32,
                vertices: polygon
                    .into_iter()
                    .map(|v| [rect[0] + v.point[0] * long, rect[1] + v.point[1] * long])
                    .collect(),
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{cells, partition};
    use std::collections::BTreeMap;

    #[test]
    fn exact_degenerate_constraints_do_not_add_duplicate_fan_vertices() {
        for sites in [
            vec![[0.25, 0.25], [0.75, 0.25], [0.75, 0.75], [0.25, 0.75]],
            vec![[0.25, 0.1875], [0.75, 0.1875], [0.5, 0.3125]],
            vec![[0.25, 0.75], [0.75, 0.25]],
            vec![
                [0.25, 0.1875],
                [0.75, 0.1875],
                [0.5, 0.3125 - 2.0_f64.powi(-42)],
            ],
            vec![
                [0.25, 0.1875],
                [0.75, 0.1875],
                [0.5, 0.3125 + 2.0_f64.powi(-42)],
            ],
        ] {
            let cells = partition([0.0, 0.0, 1.0, 1.0], &sites);
            let mut area = 0.0;
            let mut triangles = 0;
            let mut edges = BTreeMap::new();
            for cell in &cells {
                assert!(cell.vertices.len() >= 3);
                triangles += cell.vertices.len() - 2;
                let mut cell_area = 0.0;
                for i in 0..cell.vertices.len() {
                    let a = cell.vertices[i];
                    let b = cell.vertices[(i + 1) % cell.vertices.len()];
                    let c = cell.vertices[(i + 2) % cell.vertices.len()];
                    assert_ne!(a, b, "duplicate Voronoi vertex");
                    let cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
                    assert!(cross >= -1e-14, "nonconvex Voronoi cell");
                    cell_area += (a[0] * b[1] - b[0] * a[1]) * 0.5;
                    let a = (a[0].to_bits(), a[1].to_bits());
                    let b = (b[0].to_bits(), b[1].to_bits());
                    let key = if a < b { (a, b) } else { (b, a) };
                    edges.entry(key).or_insert_with(Vec::new).push(a < b);
                }
                assert!(cell_area > 0.0);
                area += cell_area;
            }
            assert!((area - 1.0).abs() < 1e-12);
            assert!(triangles <= 4 * sites.len() - 2);
            for ((a, b), directions) in edges {
                let a = [f64::from_bits(a.0), f64::from_bits(a.1)];
                let b = [f64::from_bits(b.0), f64::from_bits(b.1)];
                let boundary = (0..2).any(|axis| {
                    (a[axis] == 0.0 && b[axis] == 0.0) || (a[axis] == 1.0 && b[axis] == 1.0)
                });
                if boundary {
                    assert_eq!(directions.len(), 1);
                } else {
                    assert_eq!(directions.len(), 2, "unshared edge {a:?} -> {b:?}");
                    assert_ne!(directions[0], directions[1]);
                }
            }
        }
    }

    #[test]
    fn nearby_topological_vertices_are_not_welded_by_coordinate_distance() {
        let sites = [
            [0.25, 0.1875],
            [0.75, 0.1875],
            [0.5, 0.3125 - 2.0_f64.powi(-42)],
        ];
        let cells = partition([0.0, 0.0, 1.0, 1.0], &sites);
        let mut top: Vec<_> = cells
            .iter()
            .flat_map(|c| &c.vertices)
            .filter(|p| p[1] == 0.0 && (0.4..0.6).contains(&p[0]))
            .map(|p| p[0])
            .collect();
        top.sort_by(f64::total_cmp);
        top.dedup();
        assert_eq!(
            top.len(),
            2,
            "different incident constraints must remain different vertices"
        );
        assert!(top[1] - top[0] > 0.0 && top[1] - top[0] < 2e-12);
    }

    #[test]
    fn bounded_seeded_partitions_retain_all_cells_and_the_fan_budget() {
        for count in [4, 31, 128, 512] {
            for seed in [0, 27, u32::MAX] {
                for rect in [
                    [0.0, 0.0, 1.0, 1.0],
                    [0.0, 0.0, 8192.0, 0.01],
                    [0.0, 0.0, 0.01, 8192.0],
                ] {
                    let cells = cells(rect, count, seed);
                    assert_eq!(cells.len(), count as usize);
                    let mut area = 0.0;
                    let mut triangles = 0;
                    for (index, cell) in cells.iter().enumerate() {
                        assert_eq!(cell.key, index as u32);
                        assert!(cell.vertices.len() >= 3);
                        triangles += cell.vertices.len() - 2;
                        for i in 0..cell.vertices.len() {
                            let a = cell.vertices[i];
                            let b = cell.vertices[(i + 1) % cell.vertices.len()];
                            assert!(a.iter().all(|v| v.is_finite()));
                            assert_ne!(a, b);
                            area += (a[0] * b[1] - b[0] * a[1]) * 0.5;
                        }
                    }
                    assert!((area / (rect[2] * rect[3]) - 1.0).abs() < 1e-10);
                    assert!(triangles <= 4 * count as usize - 2);
                }
            }
        }
    }
}

pub(super) fn rotate([x, y, z]: [f64; 3], angles: [f64; 3]) -> [f64; 3] {
    let (sx, cx) = angles[0].sin_cos();
    let (sy, cy) = angles[1].sin_cos();
    let (sz, cz) = angles[2].sin_cos();
    let after_x = [x, y * cx - z * sx, y * sx + z * cx];
    let after_y = [
        after_x[0] * cy + after_x[2] * sy,
        after_x[1],
        -after_x[0] * sy + after_x[2] * cy,
    ];
    [
        after_y[0] * cz - after_y[1] * sz,
        after_y[0] * sz + after_y[1] * cz,
        after_y[2],
    ]
}

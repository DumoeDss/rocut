use super::model::PreparedSource;

fn source(width: u32, height: u32, occupied: impl Fn(i32, i32) -> bool) -> PreparedSource {
    let pixels: Vec<_> = (0..height as i32)
        .flat_map(|y| {
            let occupied = &occupied;
            (0..width as i32).map(move |x| {
                if occupied(x, y) {
                    [0.2, 0.4, 0.6, 1.0]
                } else {
                    [0.0; 4]
                }
            })
        })
        .collect();
    PreparedSource::prepare(width, height, &pixels, 1.0, 1.0).unwrap()
}

fn concave(x: i32, y: i32) -> bool {
    (2..=8).contains(&x) && (2..=8).contains(&y) && (x < 5 || y < 5)
}

#[test]
fn concave_inner_corner_is_not_a_rectangle_or_circle_boundary() {
    let shape = source(12, 12, concave);
    // The concave corner sees a transparent diagonal; a filled bounding box does not.
    assert_eq!(shape.mask([4, 4]), 1.0);
    assert_eq!(shape.mask([4, 6]), 1.0);
    assert_eq!(shape.mask([6, 4]), 1.0);
    assert_eq!(shape.mask([3, 3]), 0.0);
    assert_eq!(shape.mask([6, 6]), 0.0);
    assert_eq!(shape.support([6, 6], 1.0, 1.0, 0.0), (0.0, 0.0));
    let rectangle = source(12, 12, |x, y| (2..=8).contains(&x) && (2..=8).contains(&y));
    assert_eq!(rectangle.mask([4, 4]), 0.0);
    // The L includes a corner outside an inscribed radius-three circle.
    assert_eq!(shape.mask([2, 2]), 1.0);
    let circle = source(12, 12, |x, y| (x - 5).pow(2) + (y - 5).pow(2) <= 9);
    assert_eq!(circle.mask([2, 2]), 0.0);
    assert_ne!(shape.boundary, rectangle.boundary);
    assert_ne!(shape.boundary, circle.boundary);
}

#[test]
fn disconnected_components_have_separate_edges_and_a_support_free_gap() {
    let shape = source(16, 13, |x, y| {
        (5..=7).contains(&y) && ((2..=4).contains(&x) || (10..=12).contains(&x))
    });
    assert_eq!(shape.boundary.iter().filter(|&&edge| edge == 1).count(), 16);
    for p in [[2, 6], [4, 6], [10, 6], [12, 6]] {
        assert_eq!(shape.mask(p), 1.0);
    }
    for p in [[3, 6], [11, 6], [7, 6]] {
        assert_eq!(shape.mask(p), 0.0);
    }
    assert_eq!(shape.support([7, 6], 1.0, 1.0, 0.0), (0.0, 0.0));
    let bridged = source(16, 13, |x, y| (5..=7).contains(&y) && (2..=12).contains(&x));
    assert!(bridged.support([7, 6], 1.0, 1.0, 0.0).0 > 0.0);
    assert_ne!(shape.boundary, bridged.boundary);
}

#[test]
fn alpha_hole_has_an_inner_boundary_but_no_filled_hole_mask() {
    let shape = source(13, 13, |x, y| {
        (2..=10).contains(&x)
            && (2..=10).contains(&y)
            && !((5..=7).contains(&x) && (5..=7).contains(&y))
    });
    // Outer 9x9 perimeter has 32 pixels; the 5x5 ring around the 3x3 hole has 16.
    assert_eq!(shape.boundary.iter().filter(|&&edge| edge == 1).count(), 48);
    for p in [[4, 6], [8, 6], [6, 4], [6, 8], [4, 4]] {
        assert_eq!(shape.mask(p), 1.0);
    }
    assert_eq!(shape.mask([6, 6]), 0.0);
    assert_eq!(shape.support([6, 6], 1.0, 1.0, 0.0), (0.0, 0.0));
    assert!(shape.support([5, 6], 1.0, 1.0, 0.0).0 > 0.0);
    let filled = source(13, 13, |x, y| {
        (2..=10).contains(&x) && (2..=10).contains(&y)
    });
    assert_eq!(filled.mask([4, 6]), 0.0);
    assert_ne!(shape.boundary, filled.boundary);
}

#[test]
fn moving_concave_frames_translate_edges_and_replay_without_old_support() {
    let first = source(28, 20, concave);
    let moved = source(28, 20, |x, y| concave(x - 10, y - 3));
    for y in 0..20 {
        for x in 0..28 {
            assert_eq!(moved.mask([x, y]), first.mask([x - 10, y - 3]));
        }
    }
    assert_eq!(moved.support([2, 2], 1.0, 1.0, 0.0), (0.0, 0.0));
    assert_eq!(first.support([12, 5], 1.0, 1.0, 0.0), (0.0, 0.0));
    assert!(first.support([2, 2], 1.0, 1.0, 0.0).0 > 0.0);
    assert!(moved.support([12, 5], 1.0, 1.0, 0.0).0 > 0.0);
    let replay = source(28, 20, concave);
    assert_eq!(replay.boundary, first.boundary);
    assert_eq!(replay.premultiplied, first.premultiplied);
}

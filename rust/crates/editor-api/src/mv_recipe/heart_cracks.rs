use super::{
    Session,
    draw::*,
    plan::{Command, HeartCommand},
};
pub fn build(session: &Session, progress: f64, heat: f64, burn: bool, id: String) -> Command {
    let mut d = Draw::new();
    let passes = if burn {
        [
            (rgb(255.0, 58.0, 16.0, 1.0), 10.0, 0.25),
            (rgb(255.0, 122.0, 42.0, 1.0), 4.2, 0.6),
            (rgb(255.0, 224.0, 160.0, 1.0), 1.5, 1.0),
        ]
    } else {
        [
            (rgb(255.0, 138.0, 58.0, 1.0), 10.0, 0.14 + 0.12 * heat),
            (rgb(255.0, 176.0, 96.0, 1.0), 4.0, 0.5),
            (rgb(255.0, 248.0, 236.0, 1.0), 1.5, 1.0),
        ]
    };
    for (color, width, opacity) in passes {
        for bucket in 0..3 {
            let mut path = Vec::new();
            for (edge, inside) in session
                .glass
                .fracture
                .edges
                .iter()
                .zip(&session.glass.inside)
            {
                if !inside {
                    continue;
                }
                let bk = if edge.distance < session.glass.radius_max * 0.22 {
                    0
                } else if edge.distance < session.glass.radius_max * 0.5 {
                    1
                } else {
                    2
                };
                if bk != bucket {
                    continue;
                }
                let f = (session.glass.radius_max * progress - edge.distance) / edge.length;
                if f <= 0.0 {
                    continue;
                }
                let points = super::fracture::partial(&edge.points, f.clamp(0.0, 1.0), edge.length);
                for (i, p) in points.iter().enumerate() {
                    let p = [p[0] + 20.0, p[1] + 20.0];
                    path.push(if i == 0 { mv(p) } else { ln(p) });
                }
            }
            let mut paint = stroke(
                color,
                width * [1.45, 1.0, 0.7][bucket],
                "source-over",
                "round",
                "round",
            );
            paint.opacity = opacity;
            d.path(path, vec![paint]);
        }
    }
    let size = [
        session.body.display_size[0] as u32,
        session.body.display_size[1] as u32,
    ];
    d.blit(
        "heart-body",
        size,
        [20.0, 20.0, size[0] as f64, size[1] as f64],
        1.0,
        "destination-in",
    );
    Command::Heart(HeartCommand::OwnedSurface {
        id,
        size: [size[0] + 40, size[1] + 40],
        commands: d.commands,
    })
}

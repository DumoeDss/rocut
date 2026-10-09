use super::super::{clock::Clock, draw::Draw, finishing, plan::Command, state::State};
use super::{facts, sample, settings};

#[test]
fn grain_history_is_the_actual_preceding_vignette_at_every_sample() {
    for variant in ["default", "night", "hand"] {
        for time in [4.0, 4.5, 5.6, 7.99] {
            let a = settings(variant);
            let sample = sample(time);
            let clock = Clock::new(&a, &sample).unwrap();
            let state = State::new(&a, &clock);
            let (fonts, _) = facts(&a, &sample);
            let mut draw = Draw::new(1920.0, 1080.0);
            finishing::draw(&mut draw, &a, &clock, &state, &fonts).unwrap();
            let Command::Grain {
                fill_history: Some(history),
                ..
            } = draw.commands.last().unwrap()
            else {
                panic!("Every Kanji grain requires its reference paint history");
            };
            let Command::Rect {
                transform,
                operations,
                paint,
                ..
            } = &draw.commands[draw.commands.len() - 2]
            else {
                panic!("Reference grain must follow the actual vignette");
            };
            assert!(operations.is_empty());
            assert_eq!(history.transform, *transform);
            assert_eq!(
                serde_json::to_value(&history.style).unwrap(),
                serde_json::to_value(&paint.style).unwrap()
            );
            assert_eq!(history.transform, [1.0, 0.0, 0.0, 1.0, 0.0, 0.0]);
            let wire = serde_json::to_value(draw.commands.last().unwrap()).unwrap();
            assert!(wire.get("fill_history").is_none());
            assert_eq!(wire["fillHistory"]["style"]["kind"], "radial");
            assert_eq!(wire["opacity"], 0.1);
            assert_eq!(wire["gray"].as_array().unwrap().len(), 65536);
        }
    }
}

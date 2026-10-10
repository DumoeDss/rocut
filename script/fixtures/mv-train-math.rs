#[path="../../rust/crates/editor-api/src/mv_recipe/train_math.rs"]mod math;
// Harness-only author DTOs. The production geometry functions themselves are
// compiled unchanged; no mocked motion, clock, random or content functions.
mod model{
 pub struct Settings{pub cars:Option<usize>,pub exit_at:Option<f64>,pub hero_x:Option<f64>,pub hero:Option<usize>,pub bpm:f64}
 impl Settings{pub fn freeze(&self)->[f64;2]{[116.76,116.93]}pub fn characters(&self)->Vec<&str>{vec!["assets/char/bust_sing.png","assets/char/bust_calm.png","assets/char/eyes_ecu.png","assets/char/smile_dawn.png"]}}
 pub struct Sample<'a>{pub beats:&'a[f64]}
 impl Sample<'_>{pub fn start(&self)->f64{115.0}pub fn end(&self)->f64{119.0}}
}
#[path="../../rust/crates/editor-api/src/mv_recipe/train_geometry.rs"]mod geometry;
fn main(){let beats=[113.0,113.57,114.06,114.63,115.11,115.72,116.21,116.76,117.29,117.88,118.41,119.02,119.53,120.08,120.71];let s=model::Sample{beats:&beats};let a=model::Settings{cars:None,exit_at:None,hero_x:None,hero:None,bpm:123.0};let g=geometry::build(&a,&s).unwrap();println!("plan,{},{},{},{},{}",g.length,g.velocity,g.shift,g.best.unwrap(),g.windows.len());for e in &g.windows{println!("window,{},{},{},{}",e.car,e.u0,e.u1,e.window.unwrap());}for (i,c) in g.contents.iter().enumerate(){let crop=c.crop.map(|r|r.iter().map(f64::to_string).collect::<Vec<_>>().join(":")).unwrap_or_else(||"-".into());println!("content,{i},{},{},{},{}",c.character.as_deref().unwrap_or("-"),crop,c.seed,c.hero);}
 for t in [100.0,115.0,116.759999,116.76,116.8,116.929999,116.93,117.85,120.0,1000.0]{let xf=g.front(t);let lv=geometry::lamp_levels(&beats,123.0,2,t);println!("time,{t},{},{},{},{},{}",geometry::time(t,g.freeze),xf,xf-g.length,lv[0],lv[1]);for x in [0.0,960.0,1010.0,1920.0,xf,xf-1494.0,xf-1494.001,xf-1560.0]{println!("occupied,{t},{x},{}",g.occupied(xf,x));}}
}

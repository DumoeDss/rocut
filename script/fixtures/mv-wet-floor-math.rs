#[path="../../rust/crates/editor-api/src/mv_recipe/wet_floor_math.rs"]
mod math;
fn main(){
 for i in -20..=20{let x=i as f64*0.137;println!("math,{},{},{},{}",math::hash(&[x,71.0]),math::rnd(&[x,71.0]),math::noise(x,17.0),math::fbm(x,11.0));}
 for age in [-0.001,0.0,0.001,0.039999,0.04,0.6,1.25,2.299999,2.3,2.4]{for (r,a,j) in math::count_rings(age){println!("count,{age},{r},{a},{j}");}for (r,a,j) in math::fall_rings(age,128.0,true){println!("fall,{age},{r},{a},{j}");}}
 let beats=[0.25,0.76,1.37,1.91,2.58,3.06,3.8];for t in [0.0,0.25,0.759999,0.76,1.0,3.8,4.3,20.0]{println!("clock,{t},{},{},{}",math::phase(&beats,123.0,t),math::pulse(&beats,t,6.0),math::down(&beats,2,t));}
 for i in 0..140{let th=i as f64/140.0*math::TAU;let c=th.cos();let s=th.sin();let wob=1.0+0.12*math::fbm(c*1.6+7.0,11.0)+0.1*math::fbm(s*1.9+3.0,17.0)+0.035*(th*5.0+1.0).sin()+0.012*(th*23.0).sin();println!("puddle,{},{},{}",i,960.0+c*760.0*wob,566.0+s*336.0*wob);}
}

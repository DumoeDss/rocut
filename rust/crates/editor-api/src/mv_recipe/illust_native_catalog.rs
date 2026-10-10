use serde_json::{Value, json};
pub(in crate::mv_recipe) fn entry() -> Value {
    json!({
        "requires":["reviewed-whole-song-analysis","admitted-image-dimensions","native-html-canvas-2d"],
        "binding":"settings/bpm/span; exact1920x1080; all role layers derived from one mapped song/shot clock",
        "parameters":{
            "bg":"optional declared image","bgFrom":"zoom/x/y/rot","bgTo":"zoom/x/y/rot","bgEase":"recipe Ease","beatZoom":"0..2","shake":"0..256px","color":"rgba","grad":"stops/amount/composite","tint":"color/amount/composite[] max16","overlayGrad":"stops/amount/composite",
            "layers":"max32: image/from:[x,y,h]/to:[x,y,h]/easing/anchor/alpha/rotation/role",
            "chars":"max32: sprite:{image,x,y,h,anchor,flip,rot,sway,breathe,phase,alpha,wave:{amp,from,freq,speed,drawingFps},disableWave}; to:[x,y,h],easing,drawingFps,entrance/exit:{at,duration,dx,dy,ds,rotation,alpha,easing},beatBump,shadow/rim:{color,offset,amount},silhouette,glowAt:[x,y,r] in height units,glowColor,glowAmount,role",
            "fxBack":"background role, ordered before characters","fx":"graphics role, ordered after characters",
            "effects":"embers/fireflies/rain/dust/feathers/rays/glow/cracks/grad/fill; explicit bounded numeric controls and rgba, no custom functions",
            "vignette":"0..1"},
        "roles":"background framing/tint/layers/fxBack; subject characters; graphics fx/vignette; actor role foreground preserves front-of-lyric placement",
        "response":"original cover pan+rot/beat zoom/24fps shake; parallax; quantized actor interpolation/entrance/exit/beat bump;90 original overlapped hair strips/y-only breathing;cel shadow/3px lighter rim/silhouette/glow;full deterministic standard illustration effects",
        "clock":"closed-form random seek, real whole-song beat pulses and independent drawing rates, no accumulated simulation",
        "limits":{"expandedWork":4096,"framePlanBytes":4194304,"actors":32,"layers":32,"effectSystems":32},
        "budget":"actual max selected image tint plus native full-frame filter scratch; image residency charged separately"
    })
}

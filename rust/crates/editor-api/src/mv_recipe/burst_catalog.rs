use serde_json::{Value, json};
pub(in crate::mv_recipe) fn entry() -> Value {
    json!({
        "requires":["reviewed-whole-song-analysis","admitted-image-dimensions","native-html-canvas-2d"],
        "binding":"role/settings/bpm/span; exact1920x1080; ref/sequence mapped source clock",
        "parameters":{
            "cuts":{"type":"array","minLength":1,"maxLength":64,"required":true,"items":{"bg":{"type":"image-resource","required":false},"color":{"type":"rgba","required":false},
                "view":{"type":"cover-view","zoom":[0.01,16],"x":[-16,16],"y":[-16,16],"rot":[-100,100]},"viewTo":{"type":"cover-view"},
                "character":{"type":"object","image":"declared image resource","x":"pixel anchor","y":"pixel anchor","h":"pixel height","anchor":"fraction tuple","flip":"boolean","rot":"radians","sway":"radians","breathe":"multiplier","phase":"radians","alpha":"0..1","wave":"amp/from/freq/speed/drawingFps","disableWave":"boolean"},
                "dir":{"type":"enum","values":[-1,1]},"rim":{"type":"rgba"},"disableRim":{"type":"boolean"},"rimDir":{"type":"enum","values":[-1,1]},"rimA":{"type":"number","min":0,"max":1},
                "lamps":{"type":"object","a":"image-pixel points","b":"image-pixel points","radius":"image-pixel radius","maxPoints":64},
                "tint":{"type":"array","maxLength":16,"items":"color/amount/composite"},"lineColor":{"type":"rgba"}}},
            "every":{"type":"u32","min":1,"max":21600,"suggested":1},"lead":{"type":"number","min":0,"max":1,"suggested":0.03333333333333333},
            "flash":{"type":"alt|all|none|cut-index-array|boolean"},"flashColor":{"type":"rgba"},"speed":{"type":"boolean","suggested":true},
            "grade":{"type":"enum","values":["night2dawn"]},"roll":{"type":"number","min":-1,"max":1,"suggested":0.018},"rim":{"type":"rgba"},"disableRim":{"type":"boolean"},"hudFont":{"type":"physical-font-resource","required":false}},
        "response":"beat mini-shots; quarter-eased framing, arrival overshoot, lamps,22 quantized speed streaks,12fps pop,90 original overlapped wave strips,y-only breathe,cel rim,two-pass night/dawn grade,vignette,dutch roll,three/two arrival echoes,one/two-frame flash,optional CUT HUD",
        "clock":"pure song seek; every steps on real whole-song grid; lead defaults1/30s; arrival frames sampled at30fps; character pop12fps; speed24fps; no retained animation state",
        "sourceAnchors":"crossing-night lamps are explicit a/b/radius image-space coordinates; character and cover controls contain no image dimension claims",
        "budget":"one full-frame burst composition plus one full-resolution source tint when rim enabled; native image residency and outer compositor charged by recipe"
    })
}

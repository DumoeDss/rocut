use serde_json::{Value, json};
pub(super) fn entry() -> Value {
    json!({
        "requires":["native-memories-owner","reviewed-whole-song-analysis","native-html-canvas-2d","physical-caption-and-date-fonts"],
        "renderCapability":"pending native owner request; fixed complete replay produces a privately transferred native frame",
        "binding":"scene.role/span/bpm plus scene.settings; exact1920x1080; mapped whole-song integer ticks",
        "sceneParameters":{"bpm":{"type":"number","min":1,"max":1000,"required":true}},
        "parameters":{
            "photos":{"type":"array","minLength":1,"maxLength":16,"required":true,"items":{
                "bg":{"type":"resource","kind":"image","required":true},
                "caption":{"type":"string","maxCharacters":128,"required":false},
                "date":{"type":"string","maxCharacters":32,"required":false},
                "view":{"type":"object","required":false,"properties":{
                    "x":{"type":"number","min":-16,"max":16,"suggested":0},
                    "y":{"type":"number","min":-16,"max":16,"suggested":0},
                    "zoom":{"type":"number","min":0,"max":16,"suggested":1}}},
                "char":{"type":"boolean-or-image-resource","required":false}}},
            "char":{"type":"resource","kind":"image","required":false},
            "charIn":{"type":"i32","required":false,"meaning":"negative disables character; nonnegative must index photos"},
            "order":{"type":"photo-index-permutation","required":false},
            "dropBeats":{"type":"number-array","minLength":1,"maxLength":16,"min":0,"max":21600,"integer":true,"required":false},
            "burnBeats":{"type":"number-array","minLength":1,"maxLength":16,"min":0,"max":21600,"required":false},
            "pushAt":{"type":"number","min":-21600,"max":21600,"unit":"absolute song seconds","required":false},
            "endZoom":{"type":"number","min":0.01,"max":16,"suggested":1.9,"required":false},
            "seed":{"type":"u32","suggested":45,"required":false},
            "captionFont":{"type":"resource","kind":"font","weight":600,"style":"normal","required":true},
            "dateFont":{"type":"resource","kind":"font","weight":400,"style":"normal","required":true}},
        "identity":"image headers and native RGBA, physical SFNT glyphs and measured widths admitted by live owner; facts/stages/pixels forbidden in author JSON",
        "limits":{"jointBytes":268435456,"ownerSessions":4,"frameMetadataBytes":131072},
        "jointBudget":"outer graph/resources/post, every live Heart/Memories lease and complete frame transfers share256MiB; unknown native facts remain pending"
    })
}

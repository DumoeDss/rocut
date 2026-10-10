use serde_json::{Value, json};
pub(super) fn entries() -> Value {
    let resource = || json!({"type":"resource","kind":"image","required":true});
    let mut shatter = json!({"requires":["native-heart-owner","reviewed-whole-song-analysis","native-html-canvas-2d"],
        "renderCapability":"pending native owner request; draw requires byte/native admitted owner ready-frame map",
        "binding":"scene.role/span/bpm plus scene.settings; exact1920x1080; whole-song integer ticks and mapped references",
        "sceneParameters":{"bpm":{"type":"number","min":1,"max":1000,"required":true,"source":"explicit source-song BPM; never inferred"}},
        "parameters":{"heart":resource(),"bg":{"type":"resource","kind":"image","required":false},
            "breakBeat":{"type":"number","min":0,"max":21600,"integer":true,"required":false},
            "breakAt":{"type":"number","min":-21600,"max":21600,"required":false,"unit":"absolute song seconds"},
            "x":{"type":"number","min":-8192,"max":8192,"required":false},"y":{"type":"number","min":-8192,"max":8192,"required":false}},
        "audio":"complete reviewed beats/downbeats/stops and provenance; absence of optional stops remains absence",
        "identity":"source/bg/character are distinct complete declared descriptors; source bytes/hash/native dimensions and decoder admitted by live owner",
        "limits":{"ownerBytes":268435456,"globalBytes":268435456,"ownerSessions":4,"owners":8,"frameMetadataBytes":65536},
        "jointBudget":"host compositor/resource/post reservation plus every live owner lease must fit256MiB; unknown decoded facts remain pending"});
    let burn = shatter.clone();
    let mut gather = shatter.clone();
    gather["parameters"] = json!({"heart":resource(),"char":resource(),"bg":{"type":"resource","kind":"image","required":false},
        "firefly":{"type":"boolean","required":false},"n":{"type":"number","min":1,"max":224,"integer":true,"required":false},
        "charH":{"type":"number","exclusiveMin":0,"max":8192,"required":false},
        "charX":{"type":"number","min":-8192,"max":8192,"required":false},"charY":{"type":"number","min":-8192,"max":8192,"required":false},
        "target":{"type":"tuple","length":2,"min":-8192,"max":8192,"required":false}});
    let mut sun = gather.clone();
    sun["parameters"] = json!({"heart":resource(),"char":resource(),
        "fuseAt":{"type":"number","min":-21600,"max":21600,"required":false,"unit":"absolute song seconds"},
        "fuseBeat":{"type":"number","min":0,"max":21600,"integer":true,"required":false},
        "sunX":{"type":"number","min":-8192,"max":8192,"required":false},"sunY":{"type":"number","min":-8192,"max":8192,"required":false},
        "sunR":{"type":"number","exclusiveMin":0,"max":8192,"required":false},
        "charH":{"type":"number","exclusiveMin":0,"max":8192,"required":false},
        "charX":{"type":"number","min":-8192,"max":8192,"required":false},"charY":{"type":"number","min":-8192,"max":8192,"required":false}});
    let mut sky = shatter.clone();
    sky["parameters"] = json!({"bg":resource(),"char":resource(),"night":{"type":"css-hex-color","required":false},
        "seed":{"type":"u32","required":false},"impact":{"type":"tuple","length":2,"min":-8192,"max":8192,"required":false},
        "releaseBeat":{"type":"number","min":0,"max":21600,"integer":true,"required":false},
        "bands":{"type":"number","min":1,"max":64,"integer":true,"required":false},
        "charX":{"type":"number","min":-8192,"max":8192,"required":false},"charH":{"type":"number","exclusiveMin":0,"max":8192,"required":false}});
    sky["transport"] = json!(
        "independent Sky session and skyShatter envelope, no Heart prepared crops; exact filteredPath native filter"
    );
    shatter["ownerWireKind"] = json!("heartShatter");
    json!({"heartShatter":shatter,"heartShatterBurn":burn,"heartGather":gather,"sunBloom":sun,"skyShatter":sky})
}

use serde_json::{Value, json};
pub(super) fn entry() -> Value {
    let mut tear = json!({"requires":["native-html-canvas-2d","reviewed-whole-song-analysis","native-reference-post-backend"],
        "renderCapability":"connected scene/foreground producer; required road-original-gl-v1 post backend fails closed when absent",
        "binding":"scene.settings with non-foreground role/span; exact1920x1080; independent foreground output",
        "parameters":{"bpm":{"type":"number","required":true,"min":1,"max":1000,"suggested":120,"source":"explicit source-song BPM; never inferred"},
            "mode":{"type":"enum","options":["tear"],"suggested":"tear","required":false},
            "impact":{"type":"number","min":0,"max":21600,"suggested":1,"required":false,"unit":"absolute song seconds"},
            "horizon":{"type":"number","min":0,"max":21600,"suggested":2,"required":false,"unit":"absolute song seconds"},
            "open":{"type":"number","min":0,"max":21600,"suggested":3,"required":false,"unit":"absolute song seconds"},
            "dolly":{"type":"number","min":0,"max":21600,"suggested":4,"required":false,"unit":"absolute song seconds"}},
        "audio":"complete reviewed beats/downbeats and explicit stops evidence; no shot-window truncation",
        "nativePost":{"profile":"road-original-gl-v1","required":true,"bloom":0.55,"dawnMix":0.08,"dawnStops":[[0,"#120d24"],[0.3,"#3a2d63"],[0.55,"#9a6aa0"],[0.75,"#f3a6a0"],[0.9,"#ffd9b0"],[1,"#fffaf0"]]},
        "timelineTransition":{"kind":"black","durationSeconds":0.3,"binding":"separate INTO-shot Recipe transition; metadata never rendered as internal Road fade"},
        "limits":{"commands":16384,"expandedRoadCommands":16384,"serializedNativeFrameBytes":16777216,"jointFrameBytes":268435456}});
    let mut run = tear.clone();
    run["parameters"] = json!({"bpm":tear["parameters"]["bpm"],"mode":{"type":"enum","options":["run"],"suggested":"run","required":true},
        "char":{"type":"resource","kind":"image","required":true},
        "slowAt":{"type":"number","min":0,"max":21600,"suggested":10,"required":false,"unit":"absolute song seconds"},
        "freezeAt":{"type":"number","min":0,"max":21600,"suggested":15,"required":false,"unit":"absolute song seconds"},
        "freezeStyle":{"type":"enum","options":["photo","none"],"suggested":"photo","required":false}});
    run["nativePost"] = json!({"profile":"road-original-gl-v1","required":true,"bloom":0.55,"beatCA":2,"pulseDecay":9});
    run.as_object_mut().unwrap().remove("timelineTransition");
    tear["defaults"] = json!({"mode":"tear","char":"forbidden"});
    json!({"variants":{"tear":tear,"run":run}})
}

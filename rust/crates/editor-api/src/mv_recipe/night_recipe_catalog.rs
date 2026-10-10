use serde_json::{json, Value};

pub(super) fn entry() -> Value {
    let wet_fonts =
        json!({"mincho800":"mincho800","noto800":"noto800","dot400":"dot400","noto400":"noto400"});
    let train_fonts = json!({"mincho800":"mincho800","noto800":"noto800","mincho700":"mincho700","noto700":"noto700","dot400":"dot400","noto400":"noto400"});
    let mut instances = vec![
        json!({"id":"mincho800","resourceId":"physical/mincho800","weight":800,"axes":{}}),
        json!({"id":"noto800","resourceId":"physical/noto-variable","weight":800,"axes":{"wght":800}}),
        json!({"id":"dot400","resourceId":"physical/dot400","weight":400,"axes":{}}),
        json!({"id":"noto400","resourceId":"physical/noto-variable","weight":400,"axes":{"wght":400}}),
    ];
    let wet = json!({"binding":{"scene":"wetFloor","settings":{"mode":"fall","bg":"background","fonts":wet_fonts,
        "beats":{"kind":"manual","songTicks":[0,60000,120000]},"bpm":120,"downbeatIndex0":0}},"fontInstances":instances});
    instances.extend([
        json!({"id":"mincho700","resourceId":"physical/mincho700","weight":700,"axes":{}}),
        json!({"id":"noto700","resourceId":"physical/noto-variable","weight":700,"axes":{"wght":700}}),
    ]);
    let train = json!({"binding":{"scene":"train","settings":{"bg":"background","chars":["character"],"fonts":train_fonts,
        "beats":{"kind":"manual","songTicks":[0,60000,120000]},"bpm":120,"downbeatIndex0":0}},"fontInstances":instances,
        "lutAtlas":{"paletteResource":"palette-json","images":[{"path":"lut.png","resourceId":"palette-lut"},{"path":"duo.png","resourceId":"palette-duo"}]}});
    json!({
        "binding":"scene.settings with role/span; exact1920x1080; Rust traversal-issued occurrences preserve each mapped reference sample",
        "requires":["actual-wasm-night-owner","byte-proven-sfnt-fonts","native-image-decode","native-font-face","native-canvas-2d"],
        "authorFields":["binding","fontInstances","lutAtlas"],
        "fontInstances":"Exactly4 distinct WetFloor or6 distinct Train logical roles; physical family/style/MIME/SHA cannot be overridden; Noto800/700/400 share one real variable font with explicit wght axes",
        "physicalFonts":[
            {"id":"physical/mincho800","family":"Shippori Mincho B1","style":"normal","weight":800,"axes":{},"mimeType":"font/ttf"},
            {"id":"physical/mincho700","family":"Shippori Mincho B1","style":"normal","weight":700,"axes":{},"mimeType":"font/ttf","trainOnly":true},
            {"id":"physical/noto-variable","family":"Noto Serif JP","style":"normal","weight":200,"axes":{"wght":200},"mimeType":"font/ttf"},
            {"id":"physical/dot400","family":"DotGothic16","style":"normal","weight":400,"axes":{},"mimeType":"font/ttf"}
        ],
        "resources":"Every physical source uses actual byteLength/sha256 and programmatic-sha256 attachmentKey; logical font IDs must not shadow physical IDs; background/characters are canonical image resources; palette-json is analysis/application/json, palette-lut and palette-duo are image/image/png",
        "audio":"Manual songTicks are whole-song ordered integer ticks at120000/sec; analysis binding consumes reviewed complete song beats, never truncates to the shot",
        "variants":{
            "wetFloor":{"modes":["fall","count"],"reflection":"fall requires real418x235 background readback bound by Rust","lutAtlas":"forbidden","example":wet},
            "train":{"post":"required original tunnel-original-gl-v1 full15-pass post and byte-bound P4 LUT row; no ungraded fallback","lutAtlas":"required closed paletteResource + images path/resourceId bindings","example":train}
        },
        "limits":{"physicalManifestBytes":67108864,"ownerBytes":2147483648u64,"globalOwnerBytes":4294967296u64,"liveOwners":8,"retainedBitmapBytesPerOccurrence":8294400},
        "host":"Rust complete-graph receipt assigned after traversal; native owner/frame surfaces destroyed after final bitmap copy; retained bitmaps remain in the joint caller budget until realm disposal"
    })
}

pub(super) fn entry() -> serde_json::Value {
    let mut entry = serde_json::json!({"requires":["native-html-canvas-2d","declared-font-bytes","rust-sfnt-stack-admission","native-reference-post-backend"],
        "renderCapability":"scene/font producer connected; final render requires tunnel-original-gl-v1 backend; missing backend fails closed",
        "binding":"scene.settings with required role/span and six explicit resource IDs; reveal is preload-only",
        "parameters":{"fonts":{"type":"object","required":true,"roles":{"mincho800":{"family":"Shippori Mincho B1","weight":800},"dot400":{"family":"DotGothic16","weight":400},"heavy900":{"family":"Zen Old Mincho","weight":900},"noto400":{"family":"Noto Serif JP","weight":400,"axes":{"wght":400}},"noto800":{"family":"Noto Serif JP","weight":800,"axes":{"wght":800}},"noto900":{"family":"Noto Serif JP","weight":900,"axes":{"wght":900}}},"value":"six distinct declared font resource IDs, never CSS or paths"},
        "words":{"type":"array","minItems":1,"maxItems":32,"maxUtf8BytesPerItem":256,"suggested":["暗闇の果てで","まだ遅くない","あなたに会いたい","光","残光"]},
        "plan":{"type":"array","required":false,"minItems":1,"maxItems":256,"items":"ordered [absolute song seconds,word]"},
        "toward":{"type":"string","required":false,"suggested":"dawn","semantics":"visually inert"},
        "reveal":{"type":"resource","kind":"image","required":false,"semantics":"preload-only, never drawn"},
        "f":{"type":"number","min":1,"max":4096,"suggested":820},"v0":{"type":"number","min":0.01,"max":100,"suggested":3.1},"v1":{"type":"number","min":0.01,"max":100,"suggested":9.5},"fadeIn":{"type":"number","min":0,"max":60,"suggested":0.18},
        "beats":{"type":"union","variants":[{"kind":"manual","songTicks":"strictly increasing safe ticks;1..21600"},{"kind":"analysis"}]},"bpm":{"type":"number","min":1,"max":1000,"suggested":120},"downbeatIndex0":{"type":"number","integer":true,"min":0,"max":4294967295u64}},
        "fontMetrics":"node-bound100px scalar native advances; full ordered Resource/alias/cmap receipt; real Ō fallback, no replacement/system serif",
        "nativePost":{"profile":"tunnel-original-gl-v1","required":true,"parameters":"Rust mapped integer clock; full original GL DEFAULTS semantics required"},
        "limits":{"fontPacketBytes":67108864,"faceBytes":16777216,"glyphsPerRole":2048,"crossingBeats":2048,"glyphVisitsPerRing":32768,"totalGlyphVisits":262144,"commands":32768,"pathSteps":262144,"serializedPlanBytes":16777216,"expandedTunnelCommands":32768},
        "parity":"preserve original fullwidth space/dot widths, UTF16 short word scaling, stable depth order, unchanged ZANKŌ and black lighter rays"});
    entry["parameters"]["fonts"]["suggested"] = serde_json::json!({"mincho800":"mincho800","dot400":"dot400","heavy900":"heavy900","noto400":"noto400","noto800":"noto800","noto900":"noto900"});
    entry["parameters"]["beats"]["suggested"] =
        serde_json::json!({"kind":"manual","songTicks":[0,60000,120000,180000]});
    entry["parameters"]["downbeatIndex0"]["suggested"] = serde_json::json!(0);
    for key in ["words", "f", "v0", "v1", "fadeIn"] {
        entry["parameters"][key]["required"] = serde_json::json!(false);
    }
    entry
}

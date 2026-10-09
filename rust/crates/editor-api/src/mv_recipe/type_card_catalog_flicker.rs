use super::*;
pub(super) fn parameters() -> Value {
    let part = object(
        json!({"text":text(MAX_GLYPHS,"SIGNAL"),"position":point(),"fontSize":number(SIZE,"frame-height")}),
    );
    let pulse =
        object(json!({"kind":enumeration(&["pulse"],"pulse"),"seconds":number(HOLD,"seconds")}));
    let sustain = object(json!({"kind":enumeration(&["sustain"],"sustain")}));
    let hold = json!({"type":"union","variants":[pulse,sustain],"suggested":pulse["suggested"]});
    let frame = object(
        json!({"rect":rect(),"color":rgba(),"width":number(STROKE,"frame-height"),
        "indicator":object(json!({"rect":rect(),"color":rgba()}))}),
    );
    let layout = object(
        json!({"parts":array(part.clone(),1,MAX_PARTS,json!([part["suggested"]])),"hold":hold,
        "glitch":number(OPACITY,"ratio"),"frame":nullable(frame),
        "kickGlow":nullable(object(json!({"center":point(),"radius":number(RADIUS,"frame-height"),"color":rgba()})))}),
    );
    let ticks = json!({"type":"number","min":0,"max":MAX_SAFE_TICKS,"integer":true,"unit":"song-ticks","suggested":0});
    let manual = object(
        json!({"kind":enumeration(&["manual"],"manual"),"songTicks":array(ticks,0,MAX_BEATS,json!([0,60000,120000,180000]))}),
    );
    let analysis = object(json!({"kind":enumeration(&["analysis"],"analysis")}));
    let beats = json!({"type":"union","variants":[manual,analysis],"suggested":manual["suggested"],
        "constraints":["strictly increasing unique songTicks","at most1024 beats selected within shot after45ms snapping"]});
    let mut edge = rgba();
    edge["suggested"][3] = json!(0);
    let flood = object(
        json!({"center":point(),"radiusFrom":number(RADIUS,"frame-height"),"radiusTo":number(RADIUS,"frame-height"),
        "colors":tuple(vec![rgba(),rgba(),rgba(),edge]),"white":rgba()}),
    );
    let element = json!({"type":"enum","options":[1,3],"suggested":1});
    let morse = object(
        json!({"elements":array(element,1,MAX_MORSE,json!([1,3,1])),"position":point(),
        "unit":number(SIZE,"frame-height"),"gap":number(PADDING,"frame-height"),"height":number(STROKE,"frame-height"),
        "litColor":rgba(),"unlitColor":rgba(),"label":line("SIGNAL")}),
    );
    json!({"mode":enumeration(&["flicker"],"flicker"),"font":font(),"background":rgba(),"beats":beats,
        "layouts":array(layout.clone(),4,4,json!(vec![layout["suggested"].clone();4])),
        "rgbColors":tuple(vec![rgba(),rgba(),rgba()]),"noiseColors":tuple(vec![rgba(),rgba(),rgba()]),
        "scanlineOpacity":number(OPACITY,"erase-alpha"),"idleScanColor":rgba(),"morse":morse,"flood":flood,
        "negative":object(json!({"text":text(MAX_GLYPHS,"SIGNAL"),"position":point(),"fontSize":number(SIZE,"frame-height"),"color":rgba()})),
        "grain":number(OPACITY,"screen-alpha")})
}

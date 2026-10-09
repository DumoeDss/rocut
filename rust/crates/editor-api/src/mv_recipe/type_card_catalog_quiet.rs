use super::*;
pub(super) fn parameters() -> Value {
    let glyph = object(json!({"text":text(1,"A"),"opticalScale":number(SCALE,"ratio")}));
    let rule = object(
        json!({"color":rgba(),"offset":number(OFFSET,"frame-height"),
        "lengthScale":number(LENGTH_SCALE,"ink-line-length"),"lengthPadding":number(PADDING,"frame-height"),
        "width":number(STROKE,"frame-height"),"tickLength":number(SIZE,"frame-height")}),
    );
    json!({"mode":enumeration(&["quiet"],"quiet"),"font":font(),
        "glyphs":array(glyph.clone(),1,MAX_GLYPHS,json!([glyph["suggested"]])),
        "fontSize":number(SIZE,"frame-height"),"center":point(),
        "orientation":enumeration(&["horizontal","vertical"],"horizontal"),"gap":number(GAP,"font-size"),
        "lead":number(LEAD,"seconds"),"stagger":number(STAGGER,"seconds"),"fade":number(FADE,"seconds"),
        "color":rgba(),"background":rgba(),"rule":nullable(rule),"subtitle":nullable(line("SUBTITLE")),"grain":number(OPACITY,"screen-alpha")})
}

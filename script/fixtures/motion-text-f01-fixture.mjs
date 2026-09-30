export const MOTION_TEXT_F01_SOURCE_LINES = Object.freeze([
	"*第一句* 风从城里来!",
	"灯火/落在/肩上",
	"我们沿着节拍向前",
	"字句穿过清晨的雾",
	"镜头记住此刻颜色",
	"副歌让心跳更明亮",
	"[间奏 1.5s]",
	"回来时城市已醒来",
	"每一拍都有新方向",
	"让画面替我们说话",
	"让故事停在这一秒",
	"最后一句落向远方",
]);

export const MOTION_TEXT_F01_SOURCE = MOTION_TEXT_F01_SOURCE_LINES.join("\n");

export const MOTION_TEXT_F01_FIRST_CUE_TEXT = "第一句 风从城里来";

export const MOTION_TEXT_F01_COMMITTED_FIRST_CUE_TEXT = `${MOTION_TEXT_F01_FIRST_CUE_TEXT} · 已修改`;

export const MOTION_TEXT_F01_RENDERED_LINES = Object.freeze([
	MOTION_TEXT_F01_COMMITTED_FIRST_CUE_TEXT,
	"灯火落在肩上",
	"我们沿着节拍向前",
	"字句穿过清晨的雾",
	"镜头记住此刻颜色",
	"副歌让心跳更明亮",
	"回来时城市已醒来",
	"每一拍都有新方向",
	"让画面替我们说话",
	"让故事停在这一秒",
	"最后一句落向远方",
]);

export const MOTION_TEXT_F01_RENDERED_TEXT =
	MOTION_TEXT_F01_RENDERED_LINES.join("\n");

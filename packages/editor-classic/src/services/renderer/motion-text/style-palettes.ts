import type { MotionTextPalette } from "./types";

export const STYLE_PALETTES: Readonly<Record<string, MotionTextPalette>> = {
	base: palette(["#09090b", "#f8fafc", "#38bdf8", "#cbd5e1"]),
	noir: palette(["#060607", "#f5eeea", "#f5a50c", "#16f4d4"]),
	crimson: palette(["#c8103f", "#ffffff", "#140509", "#39f2c8"]),
	caution: palette(["#f4d21f", "#141414", "#e0231c", "#1f3fd8"]),
	magenta: palette(["#ff0a8c", "#ffffff", "#ffffff", "#2b2bd9"]),
	paper: palette(["#eee9df", "#191714", "#a23b2a", "#5c554b"]),
	hud: palette(["#131315", "#efedea", "#f25a2b", "#ffffff"]),
	mint: palette(["#0a0e0d", "#e6fff5", "#9cff3a", "#2e8c74"]),
	specimen: palette(["#1b1a1c", "#f2f0ec", "#f2f0ec", "#c8b98c"]),
	transit: palette(["#5b582b", "#ffffff", "#e8c21a", "#1a1a1a"]),
	blueprint: palette(["#1b1be8", "#ffffff", "#000000", "#ffffff"]),
	rouge: palette(["#e4e2e0", "#141414", "#d40f1c", "#141414"]),
	mono: palette(["#101010", "#f4f4f4", "#a3a3a3", "#d4d4d4"]),
	hrRuin: palette(["#161b18", "#d3dacf", "#b0473a", "#7d887e"]),
	hrNightRec: palette(["#050505", "#ededed", "#e3261e", "#8a8a8a"]),
	hrCurse: palette(["#d8cba4", "#2a2017", "#7e1410", "#6b5b45"]),
	sakura: palette(["#f8e4eb", "#4a1434", "#d93a74", "#6f8f4e"]),
	ocean: palette(["#031a2e", "#e4faff", "#1fd2e6", "#4c7dff"]),
	sunset: palette(["#2a0f44", "#fff0dc", "#ff7a30", "#ff4a86"]),
	forest: palette(["#1d291b", "#efe9d6", "#b7c95a", "#c4833f"]),
	vapor: palette(["#3a2a6e", "#ffffff", "#ff8fd8", "#7df9ff"]),
	newsprint: palette(["#e6e5e0", "#111111", "#d8141b", "#0a82c8"]),
	synth80: palette(["#0b0414", "#ff4fd8", "#22e6ff", "#ffe45c"]),
	kraft: palette(["#c49a6c", "#1a1410", "#b8361b", "#f3e9d2"]),
	candy: palette(["#bdf0e2", "#3e2a8c", "#ee3a88", "#ffb020"]),
	acid: palette(["#050505", "#c6ff00", "#ff2bd6", "#ffffff"]),
	sumi: palette(["#efe5cf", "#16130f", "#b83a22", "#16130f"]),
	gold: palette(["#0a0907", "#f3e7c4", "#d4af37", "#f3e7c4"]),
};

function palette([background, foreground, accent, secondary]: readonly [
	string,
	string,
	string,
	string,
]): MotionTextPalette {
	return { accent, background, foreground, secondary };
}

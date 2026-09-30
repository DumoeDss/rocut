import type { MotionTextStarterPresetId } from "../wasm";

export interface MotionTextStarterPresetCard {
	readonly id: MotionTextStarterPresetId;
	readonly styleId: string;
	readonly name: string;
	readonly description: string;
	readonly previewClassName: string;
	readonly textClassName: string;
	readonly previewText: string;
}

export const MOTION_TEXT_STARTER_PRESETS: readonly MotionTextStarterPresetCard[] =
	[
		{
			id: "clean-caption",
			styleId: "base",
			name: "Clean caption",
			description: "Centered fade, steady hold",
			previewClassName: "bg-neutral-950",
			textClassName: "text-white text-center text-[11px] font-medium",
			previewText: "清晰 · 克制",
		},
		{
			id: "impact-title",
			styleId: "crimson",
			name: "Impact title",
			description: "Crimson pop with a push",
			previewClassName: "bg-red-950",
			textClassName:
				"text-red-50 text-center text-xl font-black tracking-[-0.08em]",
			previewText: "冲击",
		},
		{
			id: "editorial-paper",
			styleId: "paper",
			name: "Editorial paper",
			description: "Typed rhythm and underline",
			previewClassName: "bg-stone-100",
			textClassName:
				"text-stone-950 text-left text-sm font-semibold underline decoration-2 underline-offset-4",
			previewText: "纸上排版",
		},
		{
			id: "mono-marquee",
			styleId: "mono",
			name: "Mono marquee",
			description: "Side entry, floating ticker",
			previewClassName: "bg-amber-300",
			textClassName:
				"text-black text-left text-xs font-black tracking-[0.18em] whitespace-nowrap",
			previewText: "向前 / FORWARD",
		},
	] as const;

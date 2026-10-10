import { expect, test } from "bun:test";
import { tunnelOracle, type TunnelOracleFrame } from "./mv-tunnel-oracle";
import { loadTunnelReference } from "./mv-tunnel-reference";
import { isTunnelGradient } from "./mv-tunnel-trace";

const root = process.env.ROCUT_TUNNEL_REFERENCE_ROOT;
const frame = (time: number): TunnelOracleFrame => ({
	time,
	shotStart: 0,
	duration: 4,
	beats: Array.from({ length: 25 }, (_, index) => index * 0.5),
	bpm: 120,
	downbeatIndex0: 0,
	args: {},
});
// Declared synthetic advances deliberately do not claim Japanese font parity.
const declaredWidths = ({ text, font }: { text: string; font: string }) =>
	[...text].length * (font.includes("DotGothic16") ? 50 : 100);

test("tunnel loader requires an explicit absolute original checkout", async () => {
	await expect(loadTunnelReference("relative")).rejects.toThrow("absolute");
});
test.skipIf(!root)(
	"unchanged tunnel full scripts trace all ordered layers deterministically",
	async () => {
		const reference = await loadTunnelReference(root!);
		const first = await tunnelOracle({
			reference,
			frame: frame(1),
			width: declaredWidths,
		});
		const second = await tunnelOracle({
			reference,
			frame: frame(1),
			width: declaredWidths,
		});
		expect(JSON.stringify(first)).toBe(JSON.stringify(second));
		expect(first.fonts).toHaveLength(10);
		expect(first.preload).toEqual([]);
		expect(first.surfaceCount).toBe(1);
		expect(first.calls[0]?.method).toBe("fillRect");
		expect(first.calls.some((call) => call.method === "fillText")).toBe(true);
		expect(first.calls.some((call) => call.method === "clip")).toBe(true);
		const last = first.calls.at(-1)!;
		expect(last.method).toBe("fillRect");
		expect(last.state.globalCompositeOperation).toBe("overlay");
		expect(last.state.globalAlpha).toBe(0.07);
	},
);
test.skipIf(!root)(
	"original rays retain rgba-to-hex black gradient quirk",
	async () => {
		const reference = await loadTunnelReference(root!);
		const result = await tunnelOracle({
			reference,
			frame: frame(1),
			width: declaredWidths,
		});
		const wedges = result.calls.filter(
			(call) =>
				call.method === "fill" &&
				isTunnelGradient(call.state.fillStyle) &&
				call.state.fillStyle.args[5] === 1500,
		);
		expect(wedges).toHaveLength(26);
		for (const wedge of wedges) {
			const style = wedge.state.fillStyle;
			if (!isTunnelGradient(style)) throw Error("Expected original gradient");
			expect(style.stops[0]![1]).toStartWith("rgba(0,0,0,");
			expect(style.stops[1]).toEqual([1, "rgba(0,0,0,0)"]);
		}
	},
);
test.skipIf(!root)(
	"title dawn tracking, post settle, physical grain and fade boundaries",
	async () => {
		const reference = await loadTunnelReference(root!);
		const end = await tunnelOracle({
			reference,
			frame: frame(4),
			width: declaredWidths,
		});
		const title = end.calls.find(
			(call) => call.method === "fillText" && call.args[0] === "残光",
		);
		expect(title?.state.font).toBe(
			'900 280px "Zen Old Mincho", "Noto Serif JP", serif',
		);
		expect(title?.state.letterSpacing).toBe("39px");
		expect(title?.state.globalAlpha).toBe(1);
		expect(Number(end.post.zoomBlur)).toBeCloseTo(0.058 * 0.08, 14);
		expect(Number(end.post.bloom)).toBeCloseTo(0.57, 14);
		const start = await tunnelOracle({
			reference,
			frame: frame(0),
			width: declaredWidths,
		});
		const fade = start.calls.at(-1)!;
		expect(fade.state.fillStyle).toBe("#000");
		expect(fade.state.globalAlpha).toBe(1);
		expect(fade.state.operations).toEqual([["setTransform", 1, 0, 0, 1, 0, 0]]);
	},
);
test.skipIf(!root)(
	"original explicit plan and preload-only reveal are retained",
	async () => {
		const reference = await loadTunnelReference(root!);
		const result = await tunnelOracle({
			reference,
			frame: {
				...frame(1),
				args: {
					words: ["A", "B"],
					plan: [
						[0, "C"],
						[2, "D"],
					],
					reveal: "unused.png",
				},
			},
			width: declaredWidths,
		});
		expect(result.preload).toEqual(["unused.png"]);
		expect(
			result.calls.some(
				(call) => call.method === "fillText" && call.args[0] === "C",
			),
		).toBe(true);
		expect(result.calls.some((call) => call.method === "drawImage")).toBe(
			false,
		);
	},
);

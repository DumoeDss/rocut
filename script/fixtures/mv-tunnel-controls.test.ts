import { expect, test } from "bun:test";
import { tunnelMatrix, TUNNEL_PIXEL_NEGATIVES } from "./mv-tunnel-matrix";
import { loadTunnelReference } from "./mv-tunnel-reference";
import { tunnelOracle } from "./mv-tunnel-oracle";
import type { TunnelCanvasControl } from "./mv-tunnel-canvas-controls";
const root = process.env.ROCUT_TUNNEL_REFERENCE_ROOT;
const width = ({ text, font }: { text: string; font: string }) =>
	[...text].length * (font.includes("DotGothic16") ? 50 : 100);
test.skipIf(!root)(
	"all20 original platform negative boundaries hit intended draw/metric calls (CPU only)",
	async () => {
		const reference = await loadTunnelReference(root!),
			base = tunnelMatrix()[0]!.frame;
		for (const item of TUNNEL_PIXEL_NEGATIVES) {
			const frame = { ...base, time: base.shotStart + item.index / 60 };
			const baseline = await tunnelOracle({ reference, frame, width });
			const control: TunnelCanvasControl = { name: item.name, applied: {} };
			const negative = await tunnelOracle({ reference, frame, width, control });
			expect(Object.values(control.applied).some((n) => n > 0)).toBe(true);
			expect(JSON.stringify(negative.calls)).not.toBe(
				JSON.stringify(baseline.calls),
			);
		}
	},
);
test.skipIf(!root)(
	"black rays omission is structurally26 calls, repair preserves source identities",
	async () => {
		const reference = await loadTunnelReference(root!),
			base = tunnelMatrix()[0]!.frame,
			frame = { ...base, time: base.shotStart + 3 };
		const control: TunnelCanvasControl = {
			name: "no-rays-equivalent",
			applied: {},
		};
		const baseline = await tunnelOracle({ reference, frame, width });
		const omitted = await tunnelOracle({ reference, frame, width, control });
		expect(control.applied["no-rays-equivalent"]).toBe(26);
		expect(baseline.calls.length - omitted.calls.length).toBe(26);
		expect(reference.scripts.map((s) => s.sha256)).toEqual(
			(await loadTunnelReference(root!)).scripts.map((s) => s.sha256),
		);
	},
);

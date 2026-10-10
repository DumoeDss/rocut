import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import { MV_TUNNEL_FONT_STACK_SOURCE } from "../../packages/editor-classic/src/services/renderer/programmatic/mv-tunnel-font-stack";
import type { MvTunnelMeasurement } from "../../packages/editor-contracts/src/mv-tunnel";
import { verifyProgrammaticFontResources } from "../../packages/editor-classic/src/services/renderer/programmatic/font-resources";

type Factory = (
	assets: unknown,
	fonts: unknown,
) => Promise<{
	load(stack: unknown): Promise<unknown>;
	measure(
		ctx: unknown,
		request: unknown,
	): Promise<Pick<MvTunnelMeasurement, "advances" | "nodeId">>;
	draw(ctx: unknown, command: unknown): void;
	dispose(): void;
}>;
function isFactory(value: unknown): value is Factory {
	return typeof value === "function";
}

/** Synthetic platform-boundary tests, not SFNT/FontFace/browser pixel proof. */
function fixture() {
	const bodies = [
		new Uint8Array([1, 2, 3]).buffer,
		new Uint8Array([4, 5, 6]).buffer,
	];
	const resources = bodies.map((body, i) => ({
		id: i ? "fallback" : "primary",
		kind: "font" as const,
		attachmentKey: "test" + i,
		mimeType: "font/ttf",
		byteLength: body.byteLength,
		sha256: createHash("sha256").update(new Uint8Array(body)).digest("hex"),
		font: {
			family: i ? "Noto Serif JP" : "DotGothic16",
			style: "normal" as const,
			weight: 400,
			...(i ? { axes: { wght: 400 } } : {}),
		},
	}));
	const stack = {
		role: "dot400",
		resources,
		aliases: resources.map((r) => `mv-tunnel-${r.sha256}-400`),
		routes: { A: "primary", Ō: "fallback" },
	};
	const faces: unknown[] = [];
	class MockFace {
		status = "unloaded";
		constructor(...args: unknown[]) {
			faces.push(args);
		}
		async load() {
			this.status = "loaded";
			return this;
		}
	}
	const added = new Set<unknown>();
	const factory: unknown = runInNewContext(
		MV_TUNNEL_FONT_STACK_SOURCE + "\nmvTunnelFontStacks",
		{
			ArrayBuffer,
			Uint8Array,
			FontFace: MockFace,
			mvEmberCss: () => "paint",
			mvEmberStyle: () => "paint",
		},
	);
	if (!isFactory(factory)) throw new Error("VM bridge factory missing");
	const assets = {
		descriptor: (id: string) => resources.find((r) => r.id === id),
		bytes: (id: string) => bodies[id === "primary" ? 0 : 1],
	};
	const fonts = {
		add: (face: unknown) => added.add(face),
		delete: (face: unknown) => added.delete(face),
	};
	const calls: string[] = [];
	const ctx = {
		font: "",
		letterSpacing: "hostile",
		save() {},
		restore() {},
		setTransform() {},
		measureText(scalar: string) {
			calls.push(this.font);
			return { width: scalar === "Ō" ? 73.25 : 50 };
		},
		fillText(text: string) {
			calls.push(text);
		},
	};
	return {
		factory,
		assets,
		fonts,
		stack,
		faces,
		added,
		ctx,
		calls,
		bodies,
		resources,
	};
}
describe("Tunnel admitted font stack platform bridge", () => {
	test("measures and draws unchanged Ō with the identical ordered native stack", async () => {
		const f = fixture();
		const bridge = await f.factory(f.assets, f.fonts);
		const result = await bridge.measure(f.ctx, {
			nodeId: "tunnel-node",
			fontStack: f.stack,
			fontSize: 100,
			characters: ["A", "Ō"],
		});
		expect(result.advances["Ō"]).toBe(73.25);
		expect(result.nodeId).toBe("tunnel-node");
		expect(f.faces).toHaveLength(2);
		expect(f.added.size).toBe(2);
		expect(f.calls[0]).toBe(
			`normal 400 100px "${f.stack.aliases[0]}", "${f.stack.aliases[1]}"`,
		);
		expect(f.calls[0]).not.toContain("serif");
		bridge.draw(f.ctx, {
			kind: "stackText",
			fontStack: f.stack,
			text: "AŌ",
			fontSize: 100,
			tracking: 9,
			align: "center",
			baseline: "middle",
			color: [0, 0, 0, 1],
			opacity: 1,
			composite: "source-over",
			position: [0, 0],
		});
		expect(f.ctx.font).toBe(f.calls[0]);
		expect(f.ctx.letterSpacing).toBe("9px");
		expect(f.calls.at(-1)).toBe("AŌ");
		bridge.dispose();
		expect(f.added.size).toBe(0);
	});
	test("host digest rejects changed bytes; crypto-free Worker rejects missing coverage", async () => {
		const f = fixture();
		new Uint8Array(f.bodies[0])[0] = 99;
		await expect(
			verifyProgrammaticFontResources({
				resources: f.resources.map((resource, i) => ({
					resource,
					body: f.bodies[i],
				})),
			}),
		).rejects.toThrow("digest mismatch");
		expect(f.faces).toHaveLength(0);
		const g = fixture();
		const next = await g.factory(g.assets, g.fonts);
		await next.load(g.stack);
		expect(() =>
			next.draw(g.ctx, {
				kind: "stackText",
				fontStack: g.stack,
				text: "missing",
				fontSize: 100,
				tracking: 0,
			}),
		).toThrow("coverage");
		expect(g.calls).toHaveLength(0);
	});
	test("host-verified owned snapshots survive caller mutation in a Worker without crypto", async () => {
		const f = fixture();
		const owned = await verifyProgrammaticFontResources({
			resources: f.resources.map((resource, i) => ({
				resource,
				body: f.bodies[i],
			})),
		});
		new Uint8Array(f.bodies[0])[0] = 99;
		const bridge = await f.factory(
			{
				descriptor: (id: string) =>
					owned.find((r) => r.resource.id === id)?.resource,
				bytes: (id: string) => owned.find((r) => r.resource.id === id)?.body,
			},
			f.fonts,
		);
		await bridge.load(f.stack);
		expect(f.faces).toHaveLength(2);
		expect(new Uint8Array(owned[0].body)[0]).toBe(1);
		bridge.dispose();
	});
	test("rejects missing requests and changed ordered stack identity", async () => {
		const f = fixture();
		const bridge = await f.factory(f.assets, f.fonts);
		await expect(
			bridge.measure(f.ctx, {
				fontStack: f.stack,
				fontSize: 100,
				characters: ["A"],
			}),
		).rejects.toThrow("incomplete");
		expect(() =>
			bridge.draw(f.ctx, {
				kind: "stackText",
				fontStack: { ...f.stack, resources: [...f.stack.resources].reverse() },
				text: "A",
				fontSize: 100,
				tracking: 0,
			}),
		).toThrow("not loaded");
	});
});

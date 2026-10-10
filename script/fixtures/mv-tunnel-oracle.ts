import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createContext, Script } from "node:vm";
import type { TunnelReference } from "./mv-tunnel-reference";
import { tunnelTrace, type DeclaredWidth } from "./mv-tunnel-trace";
import {
	controlledTunnelContext,
	type TunnelCanvasControl,
} from "./mv-tunnel-canvas-controls";

interface Engine {
	SCENES: Record<
		string,
		{
			draw(ctx: unknown, sample: unknown): void;
			init(): Promise<void>;
			preload(args: Record<string, unknown>): string[];
		}
	>;
	makeClock(beats: readonly number[], bpm: number, downbeat: number): unknown;
	typo: {
		post: { tunnel(sample: unknown): Record<string, unknown> };
		vp(time: number): number[];
	};
}
export interface TunnelOracleFrame {
	readonly time: number;
	readonly shotStart: number;
	readonly duration: number;
	readonly beats: readonly number[];
	readonly bpm: number;
	readonly downbeatIndex0: number;
	readonly args: Readonly<Record<string, unknown>>;
}
/** Original VM, independent of Rust/native renderer. Supplied widths are declared,
 * not actual fonts: this fixture proves call/numerical semantics, never pixels. */
export async function tunnelOracle({
	reference,
	frame,
	width,
	control,
}: {
	reference: TunnelReference;
	frame: TunnelOracleFrame;
	width: DeclaredWidth;
	control?: TunnelCanvasControl;
}) {
	const window: { Z?: Engine } = {};
	const surfaces: ReturnType<typeof tunnelTrace>[] = [];
	const fonts: string[] = [];
	const realm = createContext({
		window,
		URL,
		fetch() {
			throw Error("Tunnel CPU oracle forbids network");
		},
		document: {
			baseURI: "https://tunnel.invalid/engine/index.html",
			fonts: {
				async load(spec: string) {
					fonts.push(spec);
					return [];
				},
			},
			createElement(tag: string) {
				assert.equal(tag, "canvas");
				const trace = tunnelTrace(width);
				surfaces.push(trace);
				return { width: 0, height: 0, getContext: () => trace.api };
			},
		},
	});
	assert.equal(reference.scripts.length, 4);
	for (const source of reference.scripts) {
		assert.equal(
			createHash("sha256")
				.update(new TextEncoder().encode(source.code))
				.digest("hex"),
			source.sha256,
		);
		new Script(source.code, { filename: source.id }).runInContext(realm, {
			timeout: 1000,
		});
	}
	const z = window.Z!;
	await z.SCENES.tunnel!.init();
	const trace = tunnelTrace(width);
	const sample = {
		args: frame.args,
		t: frame.time,
		lt: frame.time - frame.shotStart,
		dur: frame.duration,
		shot: {
			id: "tunnel-cpu",
			t0: frame.shotStart,
			t1: frame.shotStart + frame.duration,
		},
		clock: z.makeClock(frame.beats, frame.bpm, frame.downbeatIndex0),
	};
	// VM timeout covers the actual original draw, not just registration.
	const context: unknown = trace.api;
	if (!isTraceCanvasBoundary(context))
		throw Error("CPU Canvas trace boundary missing");
	Object.assign(realm, {
		originalScene: z.SCENES.tunnel,
		traceContext: controlledTunnelContext({ ctx: context, control }),
		originalSample: sample,
	});
	new Script("originalScene.draw(traceContext, originalSample)").runInContext(
		realm,
		{ timeout: 5000 },
	);
	assert.ok(trace.balanced());
	return {
		calls: trace.calls,
		post: z.typo.post.tunnel(sample),
		vp: z.typo.vp(sample.lt),
		fonts,
		preload: z.SCENES.tunnel!.preload(frame.args),
		surfaceCount: surfaces.length,
	};
}
/** Mock Canvas subset for CPU call tests only, never native/font/pixel evidence. */
function isTraceCanvasBoundary(v: unknown): v is CanvasRenderingContext2D {
	return (
		typeof v === "object" &&
		v !== null &&
		["fillText", "fillRect", "createRadialGradient", "measureText"].every(
			(key) => typeof Reflect.get(v, key) === "function",
		)
	);
}

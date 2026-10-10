import type {
	ResolvedProgrammaticResource,
	ReferencePostPlan,
} from "../../packages/editor-contracts/src";
import type { ProgrammaticFrame } from "../../packages/editor-classic/src/services/renderer/programmatic/frame";
import { MV_RECIPE_RENDERER_SOURCE } from "../../packages/editor-classic/src/services/renderer/programmatic/mv-recipe-renderer";
import { MV_REFERENCE_POST_SOURCE } from "../../packages/editor-classic/src/services/renderer/programmatic/mv-reference-post";
import {
	controlledTunnelContext,
	type TunnelCanvasControl,
} from "./mv-tunnel-canvas-controls";

/** Hostile uniform boundary, not a replacement post policy or clock. */
export function controlledTunnelPost({
	plan,
	name,
	applied,
}: {
	plan: ReferencePostPlan;
	name?: string;
	applied: Record<string, number>;
}): ReferencePostPlan {
	if (!name) return plan;
	const targets: Record<
		string,
		{ shader: string; key: string; value: number | number[] }
	> = {
		"no-bloom": { shader: "final", key: "bloom", value: 0 },
		"no-post-vignette": { shader: "final", key: "vignette", value: 0 },
		"no-zoom-blur": { shader: "comp", key: "zoomBlur", value: 0 },
		"no-boil": { shader: "comp", key: "boil", value: 0 },
		"wrong-settle": { shader: "comp", key: "zoomBlur", value: 0.058 },
		"wrong-center": { shader: "comp", key: "zoomCenter", value: [0.2, 0.2] },
	};
	const target = targets[name];
	if (!target) throw Error("Unknown Tunnel post control");
	return {
		...plan,
		passes: plan.passes.map((pass) => {
			if (pass.shader !== target.shader) return pass;
			if (!(target.key in pass.uniforms))
				throw Error("Tunnel native post uniform target missing");
			applied[name] = (applied[name] ?? 0) + 1;
			return {
				...pass,
				uniforms: { ...pass.uniforms, [target.key]: target.value },
			};
		}),
	};
}

interface ReplayRuntime {
	load(
		frame: ProgrammaticFrame,
		resources: readonly ResolvedProgrammaticResource[],
	): Promise<void>;
	measure(
		ctx: CanvasRenderingContext2D,
		request: NonNullable<ProgrammaticFrame["tunnelFontMetricRequests"]>[number],
	): Promise<NonNullable<ProgrammaticFrame["tunnelFontMeasurements"]>[number]>;
	render(
		canvas: HTMLCanvasElement,
		frame: ProgrammaticFrame,
		surface: (width: number, height: number) => HTMLCanvasElement,
	): void;
	post(
		canvas: HTMLCanvasElement,
		scene: HTMLCanvasElement,
		plan: ReferencePostPlan,
	): void;
	dispose(): void;
}
function isReplayRuntime(value: unknown): value is ReplayRuntime {
	return (
		typeof value === "object" &&
		value !== null &&
		["load", "measure", "render", "post", "dispose"].every(
			(key) => typeof Reflect.get(value, key) === "function",
		)
	);
}
/** A private realm containing production trusted interpreters only. No archived
 * oracle scripts, authored code, network, eval, or global prototype mutation. */
export async function openTunnelNativeReplay() {
	const iframe = document.createElement("iframe");
	iframe.hidden = true;
	const ready = new Promise<void>((resolve, reject) => {
		iframe.onload = () => resolve();
		iframe.onerror = () => reject(Error("Tunnel replay realm failed"));
	});
	iframe.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; connect-src 'none'; font-src 'none'; img-src 'none'; frame-src 'none'; object-src 'none'">`;
	document.body.append(iframe);
	await ready;
	const realm = iframe.contentWindow,
		doc = iframe.contentDocument;
	if (!realm || !doc) {
		iframe.remove();
		throw Error("Tunnel replay native realm unavailable");
	}
	const script = doc.createElement("script");
	script.textContent = `${MV_RECIPE_RENDERER_SOURCE}\n${MV_REFERENCE_POST_SOURCE}\n
(() => {
 let bridge;
 const assets = {nativePostMode:'scene-only',get tunnelFonts(){return bridge;}};
 globalThis.__tunnelReplay = {
  async load(frame, resources) {
   if(bridge) bridge.dispose();
   const map=new Map(resources.map(r=>{const body=new Uint8Array(r.body.byteLength);body.set(new Uint8Array(r.body));return [r.resource.id,{resource:r.resource,body:body.buffer}];}));
   bridge=await mvTunnelFontStacks({bytes(id){return map.get(id).body.slice(0);},descriptor(id){return map.get(id).resource;}},document.fonts);
   for(const bound of frame.tunnelFontStacks || []) await bridge.load(bound.fontStack);
  },
  measure(ctx,request){return bridge.measure(ctx,request);},
  render(canvas,frame,surface){renderMvRecipe(canvas,frame.recipePlan,assets,surface);},
  post(canvas,scene,plan){renderReferencePost({canvas,scene,plan});},
  dispose(){if(bridge)bridge.dispose();bridge=undefined;}
 };
})();`;
	doc.head.append(script);
	const runtime: unknown = Reflect.get(realm, "__tunnelReplay");
	if (!isReplayRuntime(runtime)) {
		iframe.remove();
		throw Error("Tunnel trusted replay interpreter failed");
	}
	const canvases = new Set<HTMLCanvasElement>();
	function surface({
		width = 1920,
		height = 1080,
		control,
		fontRoles,
	}: {
		width?: number;
		height?: number;
		control?: TunnelCanvasControl;
		fontRoles?: Readonly<Record<string, string>>;
	}) {
		const canvas = doc!.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		canvases.add(canvas);
		const native = canvas.getContext.bind(canvas),
			ctx = native("2d");
		if (!ctx) throw Error("Tunnel replay native Canvas2D missing");
		const proxy = controlledTunnelContext({ ctx, control, fontRoles });
		// Only this owned surface is wrapped; WebGL output surfaces stay native.
		Object.defineProperty(canvas, "getContext", {
			value: (kind: string, options?: unknown) =>
				kind === "2d" ? proxy : Reflect.apply(native, canvas, [kind, options]),
		});
		return { canvas, ctx: proxy };
	}
	function release() {
		for (const canvas of canvases) canvas.width = canvas.height = 1;
		canvases.clear();
	}
	return {
		runtime,
		surface,
		release,
		async render({
			frame,
			resources,
			control,
			postControl,
			applied,
		}: {
			frame: ProgrammaticFrame;
			resources: readonly ResolvedProgrammaticResource[];
			control?: TunnelCanvasControl;
			postControl?: string;
			applied: Record<string, number>;
		}) {
			try {
				await runtime.load(frame, resources);
				const fontRoles: Record<string, string> = {};
				for (const bound of frame.tunnelFontStacks ?? [])
					fontRoles[bound.fontStack.aliases[0]] = bound.fontStack.role;
				const main = surface({ control, fontRoles });
				runtime.render(
					main.canvas,
					frame,
					(width, height) =>
						surface({ width, height, control, fontRoles }).canvas,
				);
				const pixels = main.ctx.getImageData(0, 0, 1920, 1080).data.slice();
				const root = frame.recipePlan?.root;
				if (root?.kind !== "tunnel")
					throw Error("Tunnel replay requires actual Rust Tunnel plan");
				const output = doc!.createElement("canvas");
				output.width = 1920;
				output.height = 1080;
				canvases.add(output);
				runtime.post(
					output,
					main.canvas,
					controlledTunnelPost({
						plan: root.nativePost.plan,
						name: postControl,
						applied,
					}),
				);
				const result = surface({});
				result.ctx.drawImage(output, 0, 0);
				return {
					pixels,
					postPixels: result.ctx.getImageData(0, 0, 1920, 1080).data.slice(),
				};
			} finally {
				release();
			}
		},
		dispose() {
			release();
			runtime.dispose();
			iframe.remove();
		},
	};
}

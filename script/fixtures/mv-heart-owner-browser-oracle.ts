import type { HeartOwnerReference } from "./mv-heart-owner-reference";
import { typeCardReferenceDigest } from "./mv-type-card-reference-realm";
import { MV_EMBER_RENDERER_SOURCE } from "../../packages/editor-classic/src/services/renderer/programmatic/mv-ember-renderer";
import { HEART_SPRITE_DIAGNOSTIC_SOURCE } from "./mv-heart-sprite-diagnostic";
interface Engine {
	loaded: Map<string, ImageBitmap>;
	canvas(width?: number, height?: number): HTMLCanvasElement;
	makeClock(beats: number[], bpm: number, offset: number): unknown;
}
interface Oracle {
	render(canvas: HTMLCanvasElement, sample: unknown, burn: boolean): void;
	diagnose(plan: unknown, preparedImage: unknown): unknown;
}
function engine(v: unknown): v is Engine {
	return (
		typeof v === "object" &&
		v !== null &&
		typeof Reflect.get(v, "makeClock") === "function" &&
		typeof Reflect.get(v, "canvas") === "function" &&
		typeof Reflect.get(v, "loaded")?.set === "function"
	);
}
function oracle(v: unknown): v is Oracle {
	return (
		typeof v === "object" &&
		v !== null &&
		typeof Reflect.get(v, "render") === "function"
	);
}
export function exposeHeartOwnerDrawBreak(code: string) {
	const end = code.lastIndexOf("})();");
	if (end < 0) throw Error("Heart original closure exposure point absent");
	return (
		code.slice(0, end) +
		"window.__heartOwnerOracle={render:(canvas,sample,burn)=>drawBreak(canvas.getContext('2d'),sample,burn)};" +
		code.slice(end)
	);
}
/** Independent complete unchanged originals, with one lexical export appended
 * immediately before glass.js closure termination. No production renderer,
 * component geometry, derived bitmap, or Rust plan is imported here. */
export async function openHeartOwnerOracle({
	reference,
	source,
	diagnosticRealm = false,
}: {
	reference: HeartOwnerReference;
	source: ImageBitmap;
	diagnosticRealm?: boolean;
}) {
	const scripts = reference.scripts.map((s) => ({ ...s }));
	const expected = [
		"core/util.js",
		"core/assets.js",
		"core/draw.js",
		"scenes/glass.js",
	];
	for (const [index, s] of scripts.entries())
		if (
			s.id !== expected[index] ||
			(await typeCardReferenceDigest(
				new TextEncoder().encode(s.code).buffer,
			)) !== s.sha256
		)
			throw Error("Heart original script identity mismatch");
	if (scripts.length !== 4)
		throw Error("Heart full original reference missing");
	const iframe = document.createElement("iframe");
	iframe.hidden = true;
	iframe.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; font-src 'none'; frame-src 'none'; base-uri https://rocut-heart-oracle.invalid"><base href="https://rocut-heart-oracle.invalid/engine/index.html">`;
	const ready = new Promise<void>((resolve, reject) => {
		iframe.onload = () => resolve();
		iframe.onerror = () => reject(Error("Heart oracle realm failed"));
	});
	document.body.append(iframe);
	await ready;
	const realm = iframe.contentWindow,
		doc = iframe.contentDocument;
	if (!realm || !doc) {
		iframe.remove();
		throw Error("Heart oracle native realm unavailable");
	}
	try {
		const allocated = new Set<HTMLCanvasElement>();
		let failure: string | undefined;
		realm.addEventListener("error", (event) => {
			failure = event.message;
		});
		for (const s of scripts) {
			const script = doc.createElement("script");
			let code = s.code;
			if (s.id === "scenes/glass.js") {
				code = exposeHeartOwnerDrawBreak(code);
				if (diagnosticRealm) {
					const end = code.lastIndexOf("})();");
					code = code.slice(0, end) + HEART_SPRITE_DIAGNOSTIC_SOURCE +
						"window.__heartOwnerOracle.diagnose=heartSpriteDiagnostics;" + code.slice(end);
				}
			}
			script.textContent = code;
			doc.head.append(script);
			if (failure) throw Error(failure);
		}
		const z: unknown = Reflect.get(realm, "Z"),
			draw: unknown = Reflect.get(realm, "__heartOwnerOracle");
		if (!engine(z) || !oracle(draw))
			throw Error("Heart full original engine missing");
		z.loaded.set("heart", source);
		const nativeCanvas = z.canvas.bind(z);
		z.canvas = (...args: Parameters<Engine["canvas"]>) => {
			const canvas = nativeCanvas(...args);
			allocated.add(canvas);
			return canvas;
		};
		const clock = z.makeClock(
			Array.from({ length: 11 }, (_, i) => i * 0.5),
			120,
			0,
		);
		return {
			async diagnose({ plan, preparedImage }: { plan: unknown; preparedImage: unknown }): Promise<unknown> {
				if (!diagnosticRealm) {
					// A separate realm is created only after failure. The acceptance
					// oracle retains its exact pre-diagnostic lexical exposure.
					const isolated = await openHeartOwnerOracle({ reference, source, diagnosticRealm: true });
					try { return await isolated.diagnose({ plan, preparedImage }); }
					finally { isolated.dispose(); }
				}
				const primitives = doc.createElement("script");
				primitives.textContent = MV_EMBER_RENDERER_SOURCE;
				doc.head.append(primitives);
				return draw.diagnose(plan, preparedImage);
			},
			render({ ticks, burn }: { ticks: number; burn: boolean }) {
				const canvas = doc.createElement("canvas");
				canvas.width = 1920;
				canvas.height = 1080;
				const t = ticks / 120000;
				try {
					draw.render(
						canvas,
						{
							args: { heart: "heart" },
							t,
							tq: Math.floor(t * 12 + 1e-6) / 12,
							p: t / 5,
							shot: { t0: 0 },
							clock,
						},
						burn,
					);
					const ctx = canvas.getContext("2d");
					if (!ctx) throw Error("Heart oracle native Canvas2D missing");
					return ctx.getImageData(0, 0, 1920, 1080).data.slice();
				} finally {
					canvas.width = canvas.height = 1;
				}
			},
			dispose() {
				for (const canvas of allocated) canvas.width = canvas.height = 1;
				allocated.clear();
				z.loaded.delete("heart");
				iframe.remove();
			},
		};
	} catch (error) {
		iframe.remove();
		throw error;
	}
}

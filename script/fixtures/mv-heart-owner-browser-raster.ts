import { MV_EMBER_RENDERER_SOURCE } from "../../packages/editor-classic/src/services/renderer/programmatic/mv-ember-renderer";
import type { MvHeartPreparedImage } from "../../packages/editor-contracts/src/mv-heart-prepared";
interface Raster {
	render(
		canvas: HTMLCanvasElement,
		plan: unknown,
		preparedImage: (image: MvHeartPreparedImage) => ImageBitmap,
	): void;
}
function raster(v: unknown): v is Raster {
	return (
		typeof v === "object" &&
		v !== null &&
		typeof Reflect.get(v, "render") === "function"
	);
}
/** Actual trusted native primitives only, isolated from archived oracle code. */
export async function openHeartOwnerRaster() {
	const iframe = document.createElement("iframe");
	iframe.hidden = true;
	iframe.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; font-src 'none'; frame-src 'none'">`;
	const ready = new Promise<void>((resolve, reject) => {
		iframe.onload = () => resolve();
		iframe.onerror = () => reject(Error("Heart native raster realm failed"));
	});
	document.body.append(iframe);
	await ready;
	const realm = iframe.contentWindow,
		doc = iframe.contentDocument;
	if (!realm || !doc) {
		iframe.remove();
		throw Error("Heart raster native realm unavailable");
	}
	const script = doc.createElement("script");
	script.textContent =
		MV_EMBER_RENDERER_SOURCE +
		`
globalThis.__heartOwnerRaster={render(canvas,plan,preparedImage){
 const ctx=canvas.getContext('2d');if(!ctx)throw Error('Heart native Canvas2D absent');
 const createSurface=(width,height)=>{if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width>4096||height>4096)throw Error('Heart native scratch dimensions invalid');const c=document.createElement('canvas');c.width=width;c.height=height;return c;};
 for(const _ of drawMvEmberSteps(ctx,plan,{preparedImage},createSurface)){}
}};`;
	doc.head.append(script);
	const draw: unknown = Reflect.get(realm, "__heartOwnerRaster");
	if (!raster(draw)) {
		iframe.remove();
		throw Error("Heart actual primitive interpreter failed");
	}
	return {
		render({
			plan,
			preparedImage,
		}: {
			plan: unknown;
			preparedImage: (image: MvHeartPreparedImage) => ImageBitmap;
		}) {
			const canvas = doc.createElement("canvas");
			canvas.width = 1920;
			canvas.height = 1080;
			try {
				draw.render(canvas, plan, preparedImage);
				const ctx = canvas.getContext("2d");
				if (!ctx) throw Error("Heart native raster readback missing");
				return ctx.getImageData(0, 0, 1920, 1080).data.slice();
			} finally {
				canvas.width = canvas.height = 1;
			}
		},
		dispose() {
			iframe.remove();
		},
	};
}

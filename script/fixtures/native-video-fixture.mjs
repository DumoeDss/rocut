import { build } from "esbuild";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(new URL("../../apps/vite-example/package.json", import.meta.url));
const playwright = await import(pathToFileURL(require.resolve("@playwright/test")).href);
const { chromium } = playwright.default ?? playwright;

/** Synthetic silent 60-frame source (30fps by default). Six black/white columns encode the
 * exact source frame, independently of any engine timeline implementation. */
export async function nativeVideoFixture(fps = 30) {
	if (![30, 100].includes(fps)) throw Error("Unsupported diagnostic source FPS");
	const bundle = await build({
		stdin: {
			resolveDir: fileURLToPath(new URL("../../packages/editor-classic", import.meta.url)),
			contents: `import {Output,BufferTarget,WebMOutputFormat,CanvasSource} from 'mediabunny';
window.fixtureReady = (async()=>{
 const canvas = new OffscreenCanvas(64,32), ctx = canvas.getContext('2d');
 const target = new BufferTarget(), output = new Output({format:new WebMOutputFormat(),target});
 const source = new CanvasSource(canvas,{codec:'vp9',bitrate:2000000});
 output.addVideoTrack(source,{frameRate:${fps}}); await output.start();
 for(let frame=0;frame<60;frame++){
   ctx.fillStyle='black'; ctx.fillRect(0,0,64,32);
   ctx.fillStyle='white'; for(let bit=0;bit<6;bit++) if(frame & (1<<bit)) ctx.fillRect(bit*8,0,8,24);
   ctx.fillStyle=['red','lime','blue'][Math.floor(frame/20)]; ctx.fillRect(0,24,64,8);
   await source.add(frame/${fps},1/${fps});
 }
 await output.finalize(); return btoa(String.fromCharCode(...new Uint8Array(target.buffer)));
})();`,
		},
		bundle: true, write: false, platform: "browser", format: "iife", logLevel: "silent",
	});
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage();
		await page.route("http://localhost/rocut-video-fixture", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>isolated diagnostic encoder</title>" }));
		await page.goto("http://localhost/rocut-video-fixture");
		await page.addScriptTag({ content: bundle.outputFiles[0].text });
		return Buffer.from(await page.evaluate(() => window.fixtureReady), "base64");
	} finally { await browser.close(); }
}

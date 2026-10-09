import { readFile } from "node:fs/promises";
import { hyperframesModuleSources } from "./hyperframes-module-sources";

export async function hyperframesResourceSources(): Promise<
	Record<string, string | Uint8Array>
> {
	const wav = Buffer.alloc(44 + 800 * 2);
	wav.write("RIFF", 0);
	wav.writeUInt32LE(wav.length - 8, 4);
	wav.write("WAVEfmt ", 8);
	wav.writeUInt32LE(16, 16);
	wav.writeUInt16LE(1, 20);
	wav.writeUInt16LE(1, 22);
	wav.writeUInt32LE(8000, 24);
	wav.writeUInt32LE(16000, 28);
	wav.writeUInt16LE(2, 32);
	wav.writeUInt16LE(16, 34);
	wav.write("data", 36);
	wav.writeUInt32LE(1600, 40);
	for (let i = 0; i < 800; i++)
		wav.writeInt16LE(
			Math.round(Math.sin((i * Math.PI) / 10) * 2000),
			44 + i * 2,
		);
	return {
		...hyperframesModuleSources,
		"index.html": hyperframesModuleSources["index.html"].replace(
			"</body>",
			`<script type="module">globalThis.__rootResource=new URL('./assets/pixel.png',import.meta.url).href;</script><script type="module" src="scenes/resource-probe.mjs"></script></body>`,
		),
		"scenes/nested.html": hyperframesModuleSources[
			"scenes/nested.html"
		].replace(
			"</body>",
			`<script type="module">globalThis.__nestedResource=new URL('../assets/pixel.png',import.meta.url).href;</script></body>`,
		),
		"assets/pixel.png": Buffer.from(
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM6kAAAAASUVORK5CYII=",
			"base64",
		),
		"assets/font.ttf": await readFile(
			new URL(
				"../../apps/web/public/motion-text/fonts/ibm-plex-mono-medium.ttf",
				import.meta.url,
			),
		),
		"assets/sound.wav": wav,
		"assets/never-execute.txt": "globalThis.__resourceExecuted=true;",
		"scenes/resource-probe.mjs": String.raw`
const originalURL = globalThis.URL, prototype = originalURL.prototype, blobFactory = originalURL.createObjectURL;
const originalBase = import.meta.url;
let baseReads = 0;
Object.defineProperty(import.meta,'url',{get(){baseReads++;return originalBase;}});
const order=[];
const picture = new URL((order.push('input'),'../assets/pixel.png'), import.meta.url);
const directBaseReads = baseReads;
const computedName = '../assets/'+'pixel.png';
const computed = new URL(computedName, import.meta.url);
const fromResolved = new URL(import.meta.resolve('../assets/pixel.png'), import.meta.url);
const image = new Image(); image.src = picture.href; await image.decode();
const fontURL = new URL('../assets/font.ttf',import.meta.url);
const face = await new FontFace('ModuleArchivedFont','url('+fontURL.href+')').load();
document.fonts.add(face);
const mediaURL = new URL('../assets/sound.wav',import.meta.url);
const audio = new Audio(); audio.muted=true; audio.preload='metadata';
await new Promise((resolve,reject)=>{audio.onloadedmetadata=resolve;audio.onerror=()=>reject(Error('Archived audio failed'));audio.src=mediaURL.href;audio.load();});
const duration=audio.duration; audio.removeAttribute('src'); audio.load();
const scoped = (function(URL){return new URL('./intentionally-undeclared-local-constructor.png',import.meta.url);})(class LocalURL {constructor(input,base){this.input=input;this.base=base;}});
const denied=[];
for(const name of ['../missing.png','../../../escape.png','https://example.invalid/no.png']) {try {new URL(name,import.meta.url);denied.push(false);}catch{denied.push(true);}}
const resourcesAsModules=[];
for(const value of [picture,new URL('../assets/never-execute.txt',import.meta.url),import.meta.resolve('../assets/font.ttf')]) {try {await import(value);resourcesAsModules.push(false);}catch{resourcesAsModules.push(true);}}
globalThis.__resourceResult={picture:picture.href,computed:computed.href,fromResolved:fromResolved.href,width:image.naturalWidth,height:image.naturalHeight,fontStatus:face.status,fontFamily:face.family,mediaDuration:duration,mediaType:mediaURL.href.split(';')[0],directBaseReads,order,scopedInput:scoped.input,nativeURL:globalThis.URL===originalURL,nativeInstance:picture.constructor===originalURL&&Object.getPrototypeOf(picture)===prototype,nativeStatic:URL.createObjectURL===blobFactory,denied,resourcesAsModules,resourceExecuted:globalThis.__resourceExecuted===true};
`,
	};
}

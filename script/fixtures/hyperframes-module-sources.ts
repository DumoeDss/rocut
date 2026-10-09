/** Authored strings: only the browser may execute these fixtures. */
export const hyperframesModuleSources: Record<string, string> = {
	"index.html": `<!doctype html><html><head><meta charset="utf-8">
<script src="gsap.js"></script>
<script type="importmap">{"imports":{"shared":"./lib/shared.mjs","flavor":"./lib/global.mjs"},"scopes":{"./scenes/":{"flavor":"./scenes/local.mjs"}}}</script>
</head><body><div id="root" data-composition-id="root" data-start="0" data-duration="1" data-width="64" data-height="64">
<div data-composition-src="scenes/nested.html" data-composition-id="nested" data-start="0" data-duration="1"></div>
</div>
<script>window.__timelines=window.__timelines||{}; window.__timelines.root=gsap.timeline({paused:true}).to({}, {duration:1});</script>
<script type="module" src="main.mjs"></script>
<script type="module">import {singleton} from 'shared'; globalThis.__inlineShared=singleton;</script>
</body></html>`,
	"main.mjs": String.raw`
import {singleton, count} from './lib/shared.mjs';
import {cycle} from './lib/cycle-a.mjs';
import {value as reexported} from './lib/reexport.mjs';
import {flavor} from 'flavor';
import data from './lib/data.json' with {type:'json'};
import {data as reexportedData} from './lib/json-reexport.mjs';
const jsonModule = await import('./lib/data.json', {with:{type:'json'}});
data.changed = true;
const jsonAttributes=[];
try {await import('./lib/data.json'); jsonAttributes.push(false);} catch {jsonAttributes.push(true);}
try {await import('./lib/data.json', {with:{type:'unsupported-test-type'}}); jsonAttributes.push(false);} catch {jsonAttributes.push(true);}
const literal = await import('./lib/lazy.mjs');
const specifier = './lib/'+'lazy.mjs';
const computed = await import(specifier);
const resolved = import.meta.resolve('./lib/lazy.mjs');
const viaResolved = await import(resolved);
const metaOnly = await import(import.meta.resolve('./lib/meta-only.mjs'));
const jsonResolved = await import(import.meta.resolve('./lib/data.json'), {with:{type:'json'}});
const metaDenied=[];
for (const name of [resolved.replace('base64,','base64,AAAA'),'data:text/javascript,globalThis.__forgedModuleExecuted=true']) {try {await import(name); metaDenied.push(false);} catch {metaDenied.push(true);}}
const names=['./lib/missing.mjs','https://example.invalid/no.mjs','node:fs'];
const denied=[];
for (const name of names) {try {await import(name); denied.push(false);} catch {denied.push(true);}}
globalThis.__moduleResult={singleton,count,cycle:cycle(),reexported,flavor,data,jsonShared:data===reexportedData&&data===jsonModule.default,jsonMutation:reexportedData.changed&&jsonModule.default.changed,jsonAttributes,literal:literal.value,computed:computed.value,sameLazy:literal===computed,denied,metaSame:import.meta===import.meta,metaUrl:import.meta.url,resolved,metaImport:viaResolved===literal,metaOnly:metaOnly.value,jsonMetaImport:jsonResolved===jsonModule,metaDenied,forgedExecuted:globalThis.__forgedModuleExecuted===true};
`,
	"lib/shared.mjs": `if(typeof process !== 'undefined') throw Error('Authored module executed outside browser');
globalThis.__sharedCount=(globalThis.__sharedCount||0)+1;
export const count=globalThis.__sharedCount;
export const singleton={value:'one-instance'};`,
	"lib/cycle-a.mjs": `import {read} from './cycle-b.mjs'; export const label='cycle-ok'; export const cycle=()=>read();`,
	"lib/cycle-b.mjs": `import {label} from './cycle-a.mjs'; export const read=()=>label;`,
	"lib/reexport.mjs": `export {value} from './lazy.mjs';`,
	"lib/lazy.mjs": `await Promise.resolve(); export const value='tla-ok';`,
	"lib/meta-only.mjs": `export const value='meta-only-ok';`,
	"lib/global.mjs": `export const flavor='global';`,
	"lib/data.json": `{"value":"json-ok"}`,
	"lib/json-reexport.mjs": `export {default as data} from './data.json' with {type:'json'};`,
	"scenes/nested.html": `<html><head></head><body><div data-composition-id="nested" data-start="0" data-duration="1" data-width="64" data-height="64"></div>
<script type="module">import {singleton} from '../lib/shared.mjs'; import {value} from './helper.mjs'; import {flavor} from 'flavor'; globalThis.__nestedModule={singleton,value,flavor};</script>
</body></html>`,
	"scenes/helper.mjs": `export const value='nested-base-ok';`,
	"scenes/local.mjs": `export const flavor='scoped';`,
};

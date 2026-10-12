/** Authored fixtures execute in Chromium only. */
export const hyperframesClassicQuerySources: Record<string, string> = {
	"index.html": `<!doctype html><html><head><meta charset="utf-8">
<script src="gsap.js"></script>
<script type="importmap">{"imports":{"dep":"./global.mjs"},"scopes":{"./logic.mjs?scoped=blue#one":{"dep":"./blue.mjs"}}}</script>
</head><body><div data-composition-id="root" data-start="0" data-duration="1" data-width="64" data-height="64">
<div data-composition-src="scenes/nested.html" data-composition-id="nested" data-start="0" data-duration="1"></div></div>
<script>window.__timelines=window.__timelines||{};window.__timelines.root=gsap.timeline({paused:true}).to({}, {duration:1});</script>
<script src="classic/start.js?origin=external#one"></script>
<script>
"use strict";
const classicReceiver=globalThis;
{
  const globalThis=null, window=null;
  const order=[];
  function specifier(){order.push('specifier');return {toString(){order.push('coerce');return './classic/lazy.mjs';}};}
  function options(){order.push('options');return {get with(){order.push('with');return {};}};}
  import(specifier(),options()).then(module=>classicReceiver.__classicInline={order,value:module.value});
  let synchronous=false;
  try {const promise=import({toString(){throw Error('conversion');}});promise.catch(error=>classicReceiver.__classicRejection={synchronous,message:error.message});}
  catch {synchronous=true;classicReceiver.__classicRejection={synchronous};}
}
</script>
<script type="module">
const fresh='./logic.mjs?runtime='+encodeURIComponent('not-statically-seen')+'#fresh';
const other=fresh.replace('#fresh','#other');
const scoped='./logic.mjs?scoped='+['blue','one'].join('#');
const a=await import(fresh), b=await import(fresh), c=await import(other), d=await import(scoped);
globalThis.__queryResult={same:a===b,different:a!==c,url:a.url,otherUrl:c.url,scopedUrl:d.url,value:a.value,scopedValue:d.value};
</script></body></html>`,
	"classic/start.js": `if(typeof process!=='undefined')throw Error('Author code ran outside Chromium');
const externalName='./lazy.mjs';
import(externalName).then(module=>globalThis.__classicExternal=module.value);`,
	"classic/lazy.mjs": `export const value='classic-ok';`,
	"logic.mjs": `import {value} from 'dep';export {value};export const url=import.meta.url;`,
	"global.mjs": `export const value='global';`,
	"blue.mjs": `export const value='blue';`,
	"scenes/nested.html": `<html><body><div data-composition-id="nested" data-start="0" data-duration="1" data-width="64" data-height="64"></div>
<script>import('../classic/lazy.mjs').then(module=>globalThis.__classicNested=module.value);</script></body></html>`,
};

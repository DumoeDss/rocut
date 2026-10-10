import { test } from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { MV_BURST_RENDERER_SOURCE } from "./mv-burst-renderer";
test("Burst replays Rust strips and smear order; cancellation releases private surfaces", () => {
	const surfaces: { width: number; height: number }[] = [], calls: unknown[][] = [];
	const context = (canvas: {width:number;height:number}) => ({ canvas,
		save() {}, restore() {}, translate(...v: unknown[]) { calls.push(["translate", ...v]); },
		transform(...v: unknown[]) { calls.push(["transform", ...v]); },
		drawImage(...v: unknown[]) { calls.push(["image", ...v]); }, fillRect() {},
	});
	const make = (width:number,height:number) => { const canvas = { width, height, getContext: () => context(canvas) }; surfaces.push(canvas); return canvas; };
	const factory = runInNewContext(MV_BURST_RENDERER_SOURCE + ";drawMvBurstSteps", {
		drawMvEmberSteps: function* (_ctx: unknown, data: { label: string }) { calls.push(["native", data.label]); yield; },
	}) as (ctx:unknown,data:unknown,assets:unknown,make:unknown)=>Generator;
	const img = { width: 100, height: 200 };
	const data = { before: {label:"before"}, after:{label:"after"}, overlay:{label:"overlay"},
		character:{image:"char",transform:[1,0,0,1,500,600],opacity:1,rim:null,
			strips:[{source:[0,0,100,101],destination:[-50,-200,100,101]}, {source:[0,100,100,101],destination:[-49,-100,100,101]}]},
		placements:[{transform:[1,0,0,1,990,540],opacity:1},{transform:[1,0,0,1,960,540],opacity:.5}],
	};
	const iterator = factory(context({width:1920,height:1080}), data, {image:()=>img}, make);
	for (const _ of iterator) void _;
	assert.equal(calls.filter(v=>v[0]==="image" && v[1]===img).length,2);
	assert.deepEqual(calls.filter(v=>v[0]==="native").map(v=>v[1]),["before","after","overlay"]);
	assert.equal(surfaces.every(v=>v.width===1&&v.height===1),true);
	const cancelled=factory(context({width:1920,height:1080}),data,{image:()=>img},make);
	cancelled.next(); cancelled.return(undefined);
	assert.equal(surfaces.every(v=>v.width===1&&v.height===1),true);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { MV_ILLUST_NATIVE_RENDERER_SOURCE } from "./mv-illust-native-renderer";
test("IllustNative role replay retains source strips, tint/blur and Rust feather geometry",()=>{
	const calls:unknown[][]=[],surfaces:{width:number;height:number}[]=[];
	const makeContext=(canvas:{width:number;height:number})=>({canvas,save(){},restore(){},translate(...v:unknown[]){calls.push(["translate",...v]);},transform(...v:unknown[]){calls.push(["transform",...v]);},
		drawImage(...v:unknown[]){calls.push(["image",...v]);},fillRect(){},beginPath(){},moveTo(...v:unknown[]){calls.push(["move",...v]);},bezierCurveTo(...v:unknown[]){calls.push(["cubic",...v]);},quadraticCurveTo(){},fill(){},stroke(){},});
	const make=(width:number,height:number)=>{const c={width,height,getContext:()=>makeContext(c)};surfaces.push(c);return c;};
	const replay=runInNewContext(MV_ILLUST_NATIVE_RENDERER_SOURCE+";drawMvIllustNativeSteps",{
		drawMvEmberSteps:function*(_c:unknown,d:{commands:unknown[]}){calls.push(["native",d.commands[0]]);yield;},mvEmberPath(){},
	})as(ctx:unknown,data:unknown,assets:unknown,make:unknown,role:string)=>Generator;
	const sprite={image:"char",opacity:1,transform:[1,0,0,1,90,100],strips:[{source:[0,0,100,101],destination:[-50,-100,100,101]}]};
	const commands=[{kind:"native",role:"background",command:{id:"bg"}},
		{kind:"sprite",role:"subject",sprite,tint:[1,0,0,1],offset:[7,-3],blurPx:3,composite:"lighter"},
		{kind:"feather",role:"graphics",transform:[1,0,0,1,50,50],color:[1,1,1,1],line:[0,0,0,1],body:[{kind:"move",point:[1,2]},{kind:"cubic",points:[3,4,5,6,7,8]}],spine:[]},
	];
	const assets={image:()=>({width:100,height:200})};
	for(const _ of replay(makeContext({width:1920,height:1080}),{commands},assets,make,"subject"))void _;
	assert.equal(calls.some(v=>v[0]==="native"),false);assert.equal(calls.some(v=>v[0]==="cubic"),false);
	assert.equal(calls.filter(v=>v[0]==="image").length,2);assert.ok(surfaces.every(v=>v.width===1&&v.height===1));
	for(const _ of replay(makeContext({width:1920,height:1080}),{commands},assets,make,"graphics"))void _;
	assert.deepEqual(calls.find(v=>v[0]==="cubic"),["cubic",3,4,5,6,7,8]);
});
